import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { RawData, WebSocket } from 'ws';
import { RtcTokenVerifierService } from '../authentication/rtc-token-verifier.service';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { OutboundSignalingMessage } from '../interfaces/signaling-message.interface';
import { MessageRouterService } from '../messages/message-router.service';
import { MessageValidatorService } from '../messages/message-validator.service';
import { SignalingActionResult } from '../messages/signaling-action.interface';
import { ConnectionRateLimitService } from '../rate-limit/connection-rate-limit.service';
import { checkMessageRate } from '../rate-limit/message-rate-limiter.util';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { SignalingEventEnvelope } from '../rooms/signaling-event.interface';
import { SignalingError } from '../signaling-error';
import {
  ClientMessageType,
  HEARTBEAT_INTERVAL_MS,
  ServerMessageType,
  SignalingErrorCode,
  SIGNALING_PATH,
} from '../signaling.constants';

// WebSocket close codes in the 4000-4999 range are reserved for
// application use (RFC 6455 §7.4.2).
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_REPLACED = 4002;
const CLOSE_RATE_LIMITED = 4029;

/**
 * Our wire format (`{"type": "..."}`, flat fields) doesn't match what
 * Nest's @SubscribeMessage/WsAdapter binding expects (`{"event": "...",
 * "data": {...}}`), so this gateway skips that binding layer and parses/
 * dispatches raw `message` events itself. handleConnection/handleDisconnect
 * still use Nest's normal gateway lifecycle hooks though.
 *
 * Multi-instance delivery works the same way as the chat gateway: this
 * gateway holds sockets and a local room index; `RoomRegistryService` and
 * `RoomEventsService` handle fleet-wide membership and fan-out over
 * Redis, so a room split across gateways still gets join/leave/relay
 * events delivered correctly (see docs/signaling.md#multi-instance).
 */
@WebSocketGateway({ path: SIGNALING_PATH })
export class SignalingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(SignalingGateway.name);
  private readonly sessions = new Map<WebSocket, ParticipantSession>();
  private heartbeatTimer?: NodeJS.Timeout;
  private unsubscribeFromRoomEvents?: () => void;

  constructor(
    private readonly tokenVerifier: RtcTokenVerifierService,
    private readonly roomRegistry: RoomRegistryService,
    private readonly roomEvents: RoomEventsService,
    private readonly messageValidator: MessageValidatorService,
    private readonly messageRouter: MessageRouterService,
    private readonly connectionRateLimit: ConnectionRateLimitService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.unsubscribeFromRoomEvents = this.roomEvents.onEvent((roomId, envelope) =>
      this.handleRoomEvent(roomId, envelope),
    );
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.logger.log(`Signaling gateway listening on ${SIGNALING_PATH}`);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.unsubscribeFromRoomEvents?.();
    for (const client of this.sessions.keys()) {
      client.terminate();
    }
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    // Auth below is async (Redis + JWT). Without pausing, a client that
    // fires off room.join right on 'open' could have that frame delivered
    // before our 'message' listener is even attached further down —
    // EventEmitter doesn't buffer for late listeners, so it'd just get
    // dropped silently. pause()/resume() holds incoming frames until
    // we're ready for them.
    client.pause();

    const clientIp = this.extractClientIp(request);

    const allowed = await this.connectionRateLimit.isAllowed(clientIp);
    if (!allowed) {
      this.logger.warn(`connection rate limited: ${clientIp}`);
      this.sendMessage(client, {
        type: ServerMessageType.ERROR,
        code: SignalingErrorCode.RATE_LIMITED,
        message: 'Too many connection attempts — please try again later',
      });
      client.resume();
      client.close(CLOSE_RATE_LIMITED, SignalingErrorCode.RATE_LIMITED);
      return;
    }

    const token = this.extractToken(request);
    let verified;
    try {
      verified = await this.tokenVerifier.verify(token ?? '');
    } catch (err) {
      const signalingError =
        err instanceof SignalingError
          ? err
          : new SignalingError(SignalingErrorCode.INVALID_TOKEN, 'Authentication failed');
      this.logger.warn(`authentication rejected from ${clientIp}: ${signalingError.code}`);
      this.sendMessage(client, signalingError.toMessage());
      client.resume();
      client.close(CLOSE_AUTH_FAILED, signalingError.code);
      return;
    }

    const session: ParticipantSession = {
      connectionId: randomUUID(),
      participantId: verified.participantId,
      projectId: verified.projectId,
      roomId: verified.roomId,
      permissions: verified.permissions,
      socket: client,
      joinedRoom: false,
      joinedAt: null,
      isAlive: true,
      messageTimestamps: [],
    };

    this.sessions.set(client, session);
    this.logger.log(
      `connection authenticated: participant=${session.participantId} room=${session.roomId}`,
    );

    client.on('message', (data: RawData) => void this.handleMessage(session, data));
    client.on('pong', () => {
      session.isAlive = true;
    });
    client.resume();
  }

  async handleDisconnect(client: WebSocket): Promise<void> {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    this.sessions.delete(client);

    if (session.joinedRoom) {
      try {
        const result = await this.messageRouter.route(session, { type: ClientMessageType.ROOM_LEAVE });
        await this.executeAction(session, result);
      } catch (err) {
        this.logger.warn(
          `room-leave cleanup failed for participant ${session.participantId}: ${(err as Error).message}`,
        );
      }
      await session.roomEventsUnsubscribe?.().catch(() => undefined);
      session.roomEventsUnsubscribe = undefined;
    }

    this.logger.log(`disconnected: participant=${session.participantId}`);
  }

  private async handleMessage(session: ParticipantSession, data: RawData): Promise<void> {
    const maxMessages = this.configService.get<number>('signaling.maxMessagesPerWindow')!;
    const windowSeconds = this.configService.get<number>('signaling.messageWindowSeconds')!;

    if (!checkMessageRate(session, maxMessages, windowSeconds)) {
      this.sendMessage(session.socket, {
        type: ServerMessageType.ERROR,
        code: SignalingErrorCode.RATE_LIMITED,
        message: 'Too many messages — slow down',
      });
      return;
    }

    try {
      const message = this.messageValidator.parse(data as Buffer);
      const result = await this.messageRouter.route(session, message);

      // Subscribe before publishing anything (including this join's own
      // possible kick) so this instance never misses an event it caused.
      if (message.type === ClientMessageType.ROOM_JOIN && session.joinedRoom && !session.roomEventsUnsubscribe) {
        session.roomEventsUnsubscribe = await this.roomEvents.subscribe(session.roomId);
      }

      await this.executeAction(session, result);

      if (message.type === ClientMessageType.ROOM_LEAVE) {
        await session.roomEventsUnsubscribe?.();
        session.roomEventsUnsubscribe = undefined;
      }
    } catch (err) {
      if (err instanceof SignalingError) {
        this.sendMessage(session.socket, err.toMessage());
      } else {
        this.logger.error(`unexpected signaling error: ${(err as Error).message}`);
        this.sendMessage(session.socket, {
          type: ServerMessageType.ERROR,
          code: SignalingErrorCode.INVALID_MESSAGE,
          message: 'Unable to process message',
        });
      }
    }
  }

  /**
   * Carries out what the router decided. Everything beyond `toSender`
   * goes through Redis — even when the target turns out to be on this
   * same instance, delivery happens uniformly via the room-events
   * subscription handler below (same trade-off chat makes: one code
   * path, not a local/remote fork, at the cost of one Redis round trip
   * per relay).
   */
  private async executeAction(session: ParticipantSession, result: SignalingActionResult): Promise<void> {
    if (result.toSender) {
      this.sendMessage(session.socket, result.toSender);
    }

    if (result.toRoom) {
      await this.roomEvents.publish(result.toRoom.roomId, {
        kind: 'broadcast',
        message: result.toRoom.message,
        excludeParticipantId: result.toRoom.excludeParticipantId,
      });
    }

    if (result.toParticipant) {
      await this.roomEvents.publish(result.toParticipant.roomId, {
        kind: 'direct',
        targetParticipantId: result.toParticipant.targetParticipantId,
        message: result.toParticipant.message,
      });
    }

    if (result.kickParticipant) {
      await this.roomEvents.publish(result.kickParticipant.roomId, {
        kind: 'kick',
        participantId: result.kickParticipant.participantId,
        exceptConnectionId: result.kickParticipant.exceptConnectionId,
      });
    }
  }

  /** Called for every event on every room this instance subscribes to (own events included). */
  private handleRoomEvent(roomId: string, envelope: SignalingEventEnvelope): void {
    switch (envelope.kind) {
      case 'broadcast': {
        for (const participant of this.roomRegistry.listParticipants(roomId, envelope.excludeParticipantId)) {
          this.sendMessage(participant.socket, envelope.message);
        }
        return;
      }
      case 'direct': {
        const target = this.roomRegistry.get(roomId, envelope.targetParticipantId);
        if (target) {
          this.sendMessage(target.socket, envelope.message);
        }
        return;
      }
      case 'kick': {
        for (const [socket, session] of this.sessions) {
          if (
            session.roomId === roomId &&
            session.participantId === envelope.participantId &&
            session.connectionId !== envelope.exceptConnectionId
          ) {
            this.sendMessage(socket, {
              type: ServerMessageType.ERROR,
              code: SignalingErrorCode.UNAUTHORIZED,
              message: 'This connection was replaced by a newer session for the same participant',
            });
            socket.close(CLOSE_REPLACED, 'replaced');
          }
        }
        return;
      }
    }
  }

  private sendMessage(socket: WebSocket, message: OutboundSignalingMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private runHeartbeat(): void {
    for (const [client, session] of this.sessions) {
      if (!session.isAlive) {
        this.logger.warn(`terminating stale connection: participant=${session.participantId}`);
        client.terminate();
        continue;
      }
      session.isAlive = false;
      client.ping();
    }
  }

  private extractToken(request: IncomingMessage): string | null {
    const url = new URL(request.url ?? '', 'http://localhost');
    return url.searchParams.get('token');
  }

  private extractClientIp(request: IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.socket.remoteAddress ?? 'unknown';
  }

  /** For observability — not exposed over the wire protocol. Local-instance only; see RoomRegistryService.getMetrics. */
  getMetrics() {
    return {
      activeConnections: this.sessions.size,
      ...this.roomRegistry.getMetrics(),
    };
  }
}
