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
import { RoomRegistryService } from '../rooms/room-registry.service';
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
 * The wire format here (`{"type": "..."}`, flat fields) doesn't match
 * what Nest's `@SubscribeMessage`/WsAdapter message binding expects
 * (`{"event": "...", "data": {...}}`), so this gateway deliberately
 * bypasses that binding layer and parses/dispatches raw `message` events
 * itself. `handleConnection`/`handleDisconnect` (Nest's gateway lifecycle
 * hooks) are still used normally. See docs/signaling.md#implementation-notes.
 */
@WebSocketGateway({ path: SIGNALING_PATH })
export class SignalingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(SignalingGateway.name);
  private readonly sessions = new Map<WebSocket, ParticipantSession>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private readonly tokenVerifier: RtcTokenVerifierService,
    private readonly roomRegistry: RoomRegistryService,
    private readonly messageValidator: MessageValidatorService,
    private readonly messageRouter: MessageRouterService,
    private readonly connectionRateLimit: ConnectionRateLimitService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.logger.log(`Signaling gateway listening on ${SIGNALING_PATH}`);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    for (const client of this.sessions.keys()) {
      client.terminate();
    }
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    // Auth below is async (Redis + JWT verification). Without pausing,
    // a client that sends its first message (e.g. room.join) immediately
    // on 'open' can have that frame delivered before the 'message'
    // listener further down is even attached — EventEmitter does not
    // buffer events for late listeners, so it would be silently dropped.
    // pause()/resume() make the socket hold incoming frames until we're
    // ready.
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

    client.on('message', (data: RawData) => this.handleMessage(session, data));
    client.on('pong', () => {
      session.isAlive = true;
    });
    client.resume();
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    this.sessions.delete(client);

    if (session.joinedRoom) {
      const result = this.messageRouter.route(session, { type: ClientMessageType.ROOM_LEAVE });
      this.executeAction(session, result);
    }

    this.logger.log(`disconnected: participant=${session.participantId}`);
  }

  private handleMessage(session: ParticipantSession, data: RawData): void {
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
      const result = this.messageRouter.route(session, message);
      this.executeAction(session, result);
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

  private executeAction(session: ParticipantSession, result: SignalingActionResult): void {
    if (result.toSender) {
      this.sendMessage(session.socket, result.toSender);
    }

    for (const { session: target, message } of result.toOthers ?? []) {
      this.sendMessage(target.socket, message);
    }

    if (result.kick) {
      this.sendMessage(result.kick.socket, {
        type: ServerMessageType.ERROR,
        code: SignalingErrorCode.UNAUTHORIZED,
        message: 'This connection was replaced by a newer session for the same participant',
      });
      result.kick.socket.close(CLOSE_REPLACED, 'replaced');
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

  /** For observability (Phase 3 §21) — not exposed over the wire protocol. */
  getMetrics() {
    return {
      activeConnections: this.sessions.size,
      ...this.roomRegistry.getMetrics(),
    };
  }
}
