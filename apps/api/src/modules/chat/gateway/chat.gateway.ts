import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { RawData, WebSocket } from 'ws';
import { generateId } from '../../../shared/utils/crypto.util';
import { ChatActor } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import {
  CHAT_CLOSE_AUTH_FAILED,
  CHAT_CLOSE_FORBIDDEN,
  CHAT_CLOSE_RATE_LIMITED,
  CHAT_CLOSE_SERVER_SHUTDOWN,
  CHAT_CLOSE_TOKEN_EXPIRED,
  CHAT_HEARTBEAT_INTERVAL_MS,
  CHAT_PATH,
  ChatClientFrame,
  ChatErrorCode,
  ChatServerFrame,
  PresenceStatus,
} from '../chat.constants';
import { ChatScope } from '../chat-permissions';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatMetricsService } from '../metrics/chat-metrics.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import { ReactionsService } from '../reactions/reactions.service';
import { ReadStateService } from '../read-state/read-state.service';
import { ChatRateLimitService } from '../rate-limit/chat-rate-limit.service';
import { ChatEventEnvelope } from '../realtime/chat-event.interface';
import { ChatEventsService } from '../realtime/chat-events.service';
import { ChatTokenService } from '../tokens/chat-token.service';
import { TypingService } from '../typing/typing.service';
import { ChatSession, RoomSubscription } from './chat-session.interface';
import { ConnectionRegistryService } from './connection-registry.service';
import { ParsedFrame, optionalString, parseClientFrame, requireString } from './chat-frame.validator';
import { DEFAULT_ENVIRONMENT } from '../../../shared/environment/environment.constants';

/**
 * The Raven Chat WebSocket gateway.
 *
 * Kept separate from the RTC signaling gateway on purpose: different path,
 * different token, different protocol, different lifecycle. A media
 * connection dropping must not take chat down with it, or the other way
 * round (spec §64, RTC is media and Chat is messaging).
 *
 * This instance holds sockets and nothing else. It owns no message state.
 * Everything durable goes through the services into Postgres, everything
 * ephemeral into Redis. That's what lets three of these run behind a load
 * balancer without any of them knowing the others exist (spec §34). Kill a
 * gateway and restart it and the only casualty is the sockets it was
 * holding, which reconnect.
 *
 * Like the RTC gateway, this sidesteps Nest's @SubscribeMessage binding.
 * Our wire format is `{"type": "..."}` with flat fields, not Nest's
 * `{"event": ..., "data": ...}`, so clients can use the browser's native
 * WebSocket instead of a framework-specific one.
 */
@WebSocketGateway({ path: CHAT_PATH })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly sessions = new Map<WebSocket, ChatSession>();
  /** conversationId -> sockets in it on *this* instance. Turns fan-out into a map lookup rather than a scan. */
  private readonly roomIndex = new Map<string, Set<WebSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;
  private unsubscribeFromEvents?: () => void;

  constructor(
    private readonly chatTokens: ChatTokenService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly reactions: ReactionsService,
    private readonly readState: ReadStateService,
    private readonly presence: PresenceService,
    private readonly typing: TypingService,
    private readonly events: ChatEventsService,
    private readonly rateLimit: ChatRateLimitService,
    private readonly metrics: ChatMetricsService,
    private readonly registry: ConnectionRegistryService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.unsubscribeFromEvents = this.events.onEvent((envelope) => this.deliverToLocalSockets(envelope));
    this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), CHAT_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    this.logger.log(`Chat gateway ${this.registry.gatewayId} listening on ${CHAT_PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.unsubscribeFromEvents?.();

    // Close cleanly with a distinct code, so clients know this was a deploy
    // instead of a network failure and can reconnect without climbing the
    // whole backoff ladder.
    for (const [socket, session] of this.sessions) {
      await this.teardownSession(session, 'server_shutdown');
      socket.close(CHAT_CLOSE_SERVER_SHUTDOWN, 'server shutting down');
    }
    this.sessions.clear();
    this.roomIndex.clear();
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    // Any frame arriving before our 'message' listener is attached gets
    // dropped in silence, because EventEmitter doesn't buffer for late
    // listeners. So pause until we're ready. Same reasoning as the RTC
    // signaling gateway.
    socket.pause();

    const clientIp = extractClientIp(request);

    if (!this.isOriginAllowed(request)) {
      this.logger.warn(`chat connection rejected: disallowed origin from ${clientIp}`);
      this.rejectConnection(
        socket,
        new ChatError(ChatErrorCode.ORIGIN_NOT_ALLOWED, 'This origin is not allowed to open a chat connection'),
        CHAT_CLOSE_FORBIDDEN,
      );
      return;
    }

    // Rate-limit by IP *before* verifying the token. Otherwise an attacker
    // gets free signature verifications, and that's the expensive part.
    try {
      await this.rateLimit.consume('connect', 'global', clientIp);
    } catch (err) {
      this.metrics.increment('global', 'connections_failed');
      this.rejectConnection(socket, err as ChatError, CHAT_CLOSE_RATE_LIMITED);
      return;
    }

    let claims;
    try {
      claims = await this.chatTokens.verify(extractToken(request) ?? '');
    } catch (err) {
      const chatError =
        err instanceof ChatError ? err : new ChatError(ChatErrorCode.INVALID_TOKEN, 'Authentication failed');
      // Never log the token, and never forward a raw verifier message. It
      // can echo parts of the malformed input straight back.
      this.logger.warn(`chat authentication rejected from ${clientIp}: ${chatError.chatCode}`);
      this.rejectConnection(
        socket,
        chatError,
        chatError.chatCode === ChatErrorCode.TOKEN_EXPIRED ? CHAT_CLOSE_TOKEN_EXPIRED : CHAT_CLOSE_AUTH_FAILED,
      );
      return;
    }

    const connectionId = generateId('ccn');
    const session: ChatSession = {
      connectionId,
      projectId: claims.pid,
      userId: claims.sub,
      scopes: claims.scopes as ChatScope[],
      tokenId: claims.jti,
      tokenExpiresAt: claims.exp * 1000,
      environment: claims.env ?? DEFAULT_ENVIRONMENT,
      conversationScope: claims.cvs ?? [],
      socket,
      rooms: new Map(),
      isAlive: true,
      connectedAt: new Date(),
      messagesSent: 0,
    };

    session.connectionRowId = await this.registry.register({
      connectionId,
      projectId: session.projectId,
      environment: session.environment,
      userId: session.userId,
      sdkVersion: extractQueryParam(request, 'sdkVersion'),
      platform: extractQueryParam(request, 'platform'),
    });

    this.sessions.set(socket, session);
    this.metrics.increment(session.projectId, 'connections_opened');

    socket.on('message', (data: RawData) => void this.handleFrame(session, data));
    socket.on('pong', () => {
      session.isAlive = true;
    });
    socket.on('error', (err: Error) => {
      this.logger.warn(`chat socket error on ${connectionId}: ${err.message}`);
    });

    this.send(socket, {
      type: ChatServerFrame.CONNECTED,
      connectionId,
      userId: session.userId,
      scopes: session.scopes,
      // Told up front, so the SDK can refresh before the socket gets closed
      // out from under it, not discovering expiry the hard way.
      expiresAt: new Date(session.tokenExpiresAt).toISOString(),
      heartbeatIntervalMs: CHAT_HEARTBEAT_INTERVAL_MS,
    });

    socket.resume();
    this.logger.log(`chat connected: ${connectionId} user=${session.userId}`);
  }

  async handleDisconnect(socket: WebSocket): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    await this.teardownSession(session, 'client_disconnected');
    this.logger.log(`chat disconnected: ${session.connectionId} user=${session.userId}`);
  }

  /**
   * Lets go of everything a socket owned: Redis subscriptions, presence,
   * typing, the connection record. Runs on clean disconnects. The TTLs on
   * every Redis key cover the unclean ones (spec §35).
   */
  private async teardownSession(session: ChatSession, reason: string): Promise<void> {
    for (const [conversationId, subscription] of session.rooms) {
      this.removeFromRoomIndex(conversationId, session.socket);
      await subscription.unsubscribe();
      await this.presence.clear(
        session.projectId,
        conversationId,
        subscription.conversationPublicId,
        session.userId,
      );
      await this.typing.stop(
        session.projectId,
        conversationId,
        subscription.conversationPublicId,
        session.userId,
        session.connectionId,
      );
    }
    session.rooms.clear();

    await this.registry.unregister({
      connectionId: session.connectionId,
      connectionRowId: session.connectionRowId,
      projectId: session.projectId,
      userId: session.userId,
      connectedAt: session.connectedAt,
      messagesSent: session.messagesSent,
      reason,
    });
  }

  // -------------------------------------------------------------------------
  // Frame handling
  // -------------------------------------------------------------------------

  private async handleFrame(session: ChatSession, data: RawData): Promise<void> {
    let frame: ParsedFrame | undefined;
    try {
      frame = parseClientFrame(data, this.configService.get<number>('chat.maxFrameBytes')!);
      await this.dispatch(session, frame);
    } catch (err) {
      this.replyWithError(session, err, frame?.id);
    }
  }

  private async dispatch(session: ChatSession, frame: ParsedFrame): Promise<void> {
    switch (frame.type) {
      case ChatClientFrame.PING:
        this.send(session.socket, { type: ChatServerFrame.PONG, id: frame.id });
        return;

      case ChatClientFrame.ROOM_JOIN:
        return this.handleRoomJoin(session, frame);

      case ChatClientFrame.ROOM_LEAVE:
        return this.handleRoomLeave(session, frame);

      case ChatClientFrame.MESSAGE_SEND:
        return this.handleSend(session, frame);

      case ChatClientFrame.MESSAGE_UPDATE: {
        const message = await this.messages.update(this.actorFor(session), requireString(frame, 'messageId', 64), {
          text: optionalString(frame, 'text', 100_000),
        });
        this.ack(session, frame.id, message);
        return;
      }

      case ChatClientFrame.MESSAGE_DELETE: {
        const message = await this.messages.delete(this.actorFor(session), requireString(frame, 'messageId', 64));
        this.ack(session, frame.id, { id: message.id, deletedAt: message.deletedAt });
        return;
      }

      case ChatClientFrame.REACTION_ADD: {
        const result = await this.reactions.add(
          this.actorFor(session),
          requireString(frame, 'messageId', 64),
          requireString(frame, 'emoji', 32),
        );
        this.ack(session, frame.id, result);
        return;
      }

      case ChatClientFrame.REACTION_REMOVE: {
        const result = await this.reactions.remove(
          this.actorFor(session),
          requireString(frame, 'messageId', 64),
          requireString(frame, 'emoji', 32),
        );
        this.ack(session, frame.id, result);
        return;
      }

      case ChatClientFrame.TYPING_START:
      case ChatClientFrame.TYPING_STOP:
        return this.handleTyping(session, frame);

      case ChatClientFrame.READ_MARK: {
        const state = await this.readState.markRead(
          this.actorFor(session),
          requireString(frame, 'messageId', 64),
        );
        this.ack(session, frame.id, state);
        return;
      }

      case ChatClientFrame.PRESENCE_SET:
        return this.handlePresenceSet(session, frame);

      default:
        throw new ChatError(ChatErrorCode.INVALID_MESSAGE_TYPE, 'Unsupported frame type');
    }
  }

  private async handleRoomJoin(session: ChatSession, frame: ParsedFrame): Promise<void> {
    const reference = requireString(frame, 'room', 128);
    await this.rateLimit.consume('subscribe', session.projectId, session.userId);

    const maxRooms = this.configService.get<number>('chat.maxRoomSubscriptionsPerConnection')!;
    if (session.rooms.size >= maxRooms) {
      throw new ChatError(
        ChatErrorCode.TOO_MANY_SUBSCRIPTIONS,
        `A connection may subscribe to at most ${maxRooms} rooms`,
      );
    }

    // Authorization happens here, not at subscribe time in Redis. A socket
    // must never be able to subscribe to a conversation it has no
    // membership in (spec §36).
    const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);

    if (session.rooms.has(conversation.id)) {
      this.ack(session, frame.id, { room: conversation.publicId, alreadyJoined: true });
      return;
    }

    const unsubscribe = await this.events.subscribe(session.projectId, conversation.id);
    const subscription: RoomSubscription = {
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      unsubscribe,
    };
    session.rooms.set(conversation.id, subscription);
    this.addToRoomIndex(conversation.id, session.socket);

    await this.presence.set(
      session.projectId,
      conversation.id,
      conversation.publicId,
      session.userId,
      PresenceStatus.ONLINE,
    );

    // Hand back the current ephemeral state, so a client joining
    // mid-conversation isn't blind until the next event fires.
    const [present, typingUsers] = await Promise.all([
      this.presence.list(session.projectId, conversation.id).catch(() => []),
      this.typing.list(session.projectId, conversation.id),
    ]);

    this.send(session.socket, {
      type: ChatServerFrame.ROOM_JOINED,
      id: frame.id,
      room: conversation.publicId,
      name: conversation.name,
      presence: present,
      typing: typingUsers,
    });
  }

  private async handleRoomLeave(session: ChatSession, frame: ParsedFrame): Promise<void> {
    const reference = requireString(frame, 'room', 128);
    const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);

    const subscription = session.rooms.get(conversation.id);
    if (!subscription) {
      throw new ChatError(ChatErrorCode.NOT_IN_ROOM, 'This connection is not subscribed to that room');
    }

    session.rooms.delete(conversation.id);
    this.removeFromRoomIndex(conversation.id, session.socket);
    await subscription.unsubscribe();
    await this.presence.clear(session.projectId, conversation.id, conversation.publicId, session.userId);
    await this.typing.stop(
      session.projectId,
      conversation.id,
      conversation.publicId,
      session.userId,
      session.connectionId,
    );

    this.send(session.socket, { type: ChatServerFrame.ROOM_LEFT, id: frame.id, room: conversation.publicId });
  }

  private async handleSend(session: ChatSession, frame: ParsedFrame): Promise<void> {
    const room = requireString(frame, 'room', 128);
    const receivedAt = Date.now();

    const result = await this.messages.send(
      this.actorFor(session),
      room,
      {
        text: optionalString(frame, 'text', 100_000),
        type: optionalString(frame, 'messageType', 32),
        replyTo: optionalString(frame, 'replyTo', 64),
        clientMessageId: optionalString(frame, 'clientMessageId', 128),
        attachmentId: optionalString(frame, 'attachmentId', 64),
        metadata: (frame.metadata as Record<string, unknown> | undefined) ?? undefined,
        clientSentAt: typeof frame.clientSentAt === 'number' ? frame.clientSentAt : undefined,
      },
      session.connectionId,
    );

    session.messagesSent += 1;

    // The ack is the *accepted and stored* signal (spec §15). It only goes
    // out once the row exists, and it carries the canonical server id. The
    // message itself still arrives separately through fan-out, so the sender
    // renders exactly what everybody else does.
    this.ack(session, frame.id, {
      message: result.message,
      deduplicated: result.deduplicated,
      status: 'stored',
      persistLatencyMs: result.persistLatencyMs,
      serverReceivedAt: new Date(receivedAt).toISOString(),
    });
  }

  private async handleTyping(session: ChatSession, frame: ParsedFrame): Promise<void> {
    const reference = requireString(frame, 'room', 128);
    const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);
    await this.rateLimit.consume('typing', session.projectId, session.userId);

    if (frame.type === ChatClientFrame.TYPING_START) {
      await this.typing.start(
        session.projectId,
        conversation.id,
        conversation.publicId,
        session.userId,
        session.connectionId,
      );
    } else {
      await this.typing.stop(
        session.projectId,
        conversation.id,
        conversation.publicId,
        session.userId,
        session.connectionId,
      );
    }

    if (frame.id) {
      this.ack(session, frame.id, { room: conversation.publicId });
    }
  }

  private async handlePresenceSet(session: ChatSession, frame: ParsedFrame): Promise<void> {
    const status = requireString(frame, 'status', 16) as PresenceStatus;
    if (!Object.values(PresenceStatus).includes(status)) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'status must be one of: online, away, offline');
    }

    // Applies to every room this socket holds. Presence is a property of
    // the person, not of one conversation.
    for (const [conversationId, subscription] of session.rooms) {
      await this.presence.set(
        session.projectId,
        conversationId,
        subscription.conversationPublicId,
        session.userId,
        status,
      );
    }

    if (frame.id) {
      this.ack(session, frame.id, { status });
    }
  }

  // -------------------------------------------------------------------------
  // Fan-out
  // -------------------------------------------------------------------------

  /**
   * Runs for every event on every conversation this instance subscribes to.
   *
   * Delivery is a map lookup against the local room index, never a scan over
   * all sockets. That's what stops a busy conversation costing
   * O(total connections) per message.
   */
  private deliverToLocalSockets(envelope: ChatEventEnvelope): void {
    const { event } = envelope;
    const sockets = this.roomIndex.get(event.conversationId);
    if (!sockets || sockets.size === 0) {
      return;
    }

    // Typing and presence echoes are just noise to whoever caused them.
    // Messages aren't: the sender needs the canonical, server-ordered row
    // back (spec §15).
    const skipOrigin =
      event.type === ChatServerFrame.TYPING_STARTED ||
      event.type === ChatServerFrame.TYPING_STOPPED ||
      event.type === ChatServerFrame.PRESENCE;

    // Never leak the routing envelope to a client.
    const { conversationId: _internal, ...clientEvent } = event as { conversationId: string };

    let delivered = 0;
    for (const socket of sockets) {
      const session = this.sessions.get(socket);
      if (!session) continue;
      if (skipOrigin && envelope.originConnectionId === session.connectionId) continue;

      this.send(socket, clientEvent as Record<string, unknown>);
      delivered += 1;
    }

    if (delivered > 0 && event.type === ChatServerFrame.MESSAGE) {
      this.metrics.increment(envelope.projectId, 'messages_fanned_out', delivered);
      // Redis publish -> local delivery. Separates fan-out cost from
      // storage cost, for when somebody asks why chat feels slow
      // (spec §48).
      this.metrics.recordLatency(envelope.projectId, 'fanout', Date.now() - envelope.publishedAt);
    }
  }

  private addToRoomIndex(conversationId: string, socket: WebSocket): void {
    const sockets = this.roomIndex.get(conversationId);
    if (sockets) {
      sockets.add(socket);
    } else {
      this.roomIndex.set(conversationId, new Set([socket]));
    }
  }

  private removeFromRoomIndex(conversationId: string, socket: WebSocket): void {
    const sockets = this.roomIndex.get(conversationId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.roomIndex.delete(conversationId);
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  /**
   * One pass, three jobs: kill sockets that missed a pong, close sockets
   * whose token has expired, and refresh the Redis TTLs behind presence and
   * the connection registry.
   *
   * Refreshing on the same timer as the liveness check is deliberate. A
   * connection that can still answer a ping is exactly the one whose
   * presence should stay alive, and coupling them means the two can never
   * disagree.
   */
  private async runHeartbeat(): Promise<void> {
    const now = Date.now();

    for (const [socket, session] of this.sessions) {
      if (!session.isAlive) {
        this.logger.warn(`terminating unresponsive chat connection ${session.connectionId}`);
        await this.teardownSession(session, 'heartbeat_timeout');
        this.sessions.delete(socket);
        socket.terminate();
        continue;
      }

      // A socket that authenticated an hour ago mustn't stay open forever
      // on a token that has since expired (spec §39).
      if (session.tokenExpiresAt <= now) {
        this.logger.log(`closing chat connection ${session.connectionId}: token expired`);
        this.send(socket, new ChatError(ChatErrorCode.TOKEN_EXPIRED, 'Chat token expired — reconnect with a new one').toFrame());
        await this.teardownSession(session, 'token_expired');
        this.sessions.delete(socket);
        socket.close(CHAT_CLOSE_TOKEN_EXPIRED, 'token expired');
        continue;
      }

      session.isAlive = false;
      socket.ping();

      await this.registry.touch(session.connectionId, session.projectId, session.userId);
      for (const [conversationId, subscription] of session.rooms) {
        await this.presence.set(
          session.projectId,
          conversationId,
          subscription.conversationPublicId,
          session.userId,
          PresenceStatus.ONLINE,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** A session is nothing more than a pre-authenticated client actor. */
  private actorFor(session: ChatSession): ChatActor {
    return {
      kind: 'client',
      projectId: session.projectId,
      environment: session.environment,
      userId: session.userId,
      scopes: session.scopes,
      tokenId: session.tokenId,
      conversationScope: session.conversationScope,
    };
  }

  private ack(session: ChatSession, id: string | undefined, data: unknown): void {
    this.send(session.socket, { type: ChatServerFrame.ACK, id, ok: true, data });
  }

  private replyWithError(session: ChatSession, err: unknown, correlationId?: string): void {
    if (err instanceof ChatError) {
      if (err.chatCode === ChatErrorCode.RATE_LIMITED) {
        this.metrics.increment(session.projectId, 'rate_limited');
      }
      this.send(session.socket, err.toFrame(correlationId));
      return;
    }

    // Anything unexpected is a bug on our side. Logged in full here,
    // reduced to a generic code for the client. No stack traces, no Postgres
    // error text, no Redis internals (spec §42).
    this.logger.error(`unhandled chat frame error: ${(err as Error)?.message}`, (err as Error)?.stack);
    this.metrics.increment(session.projectId, 'messages_failed');
    this.send(
      session.socket,
      new ChatError(ChatErrorCode.INTERNAL_ERROR, 'Could not process that request').toFrame(correlationId),
    );
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  private rejectConnection(socket: WebSocket, error: ChatError, closeCode: number): void {
    this.send(socket, error.toFrame());
    socket.resume();
    socket.close(closeCode, error.chatCode);
  }

  /**
   * Origin check for the upgrade (spec §39).
   *
   * Browsers always send Origin. Non-browser clients, a server-side bot or a
   * load test, legitimately don't. So a missing Origin is allowed while a
   * *wrong* one isn't. Page JavaScript can't forge the header, and that's
   * the attack this actually defends against.
   */
  private isOriginAllowed(request: IncomingMessage): boolean {
    const configured = this.configService.get<string>('cors.origin')!;
    if (configured === '*') {
      return true;
    }
    const origin = request.headers.origin;
    if (!origin) {
      return true;
    }
    return configured
      .split(',')
      .map((allowed) => allowed.trim())
      .includes(origin);
  }

  /** Live counts, for /health and the dashboard. */
  getMetrics() {
    return {
      gatewayId: this.registry.gatewayId,
      activeConnections: this.sessions.size,
      subscribedRooms: this.roomIndex.size,
      subscribedChannels: this.events.getSubscribedChannelCount(),
    };
  }
}

function extractToken(request: IncomingMessage): string | null {
  // Query param rather than a header, because the browser WebSocket API
  // can't set headers on an upgrade. The RTC signaling gateway makes the
  // same trade, and it's why chat tokens are short-lived and revocable: a
  // URL can end up in a proxy log.
  const url = new URL(request.url ?? '', 'http://localhost');
  return url.searchParams.get('token');
}

function extractQueryParam(request: IncomingMessage, name: string): string | undefined {
  const url = new URL(request.url ?? '', 'http://localhost');
  return url.searchParams.get(name) ?? undefined;
}

function extractClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}
