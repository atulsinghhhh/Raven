import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { RawData, WebSocket } from 'ws';
import { generateId } from '../../../shared/utils/crypto.util';
import { ProjectOriginService } from '../../../shared/origins/project-origin.service';
import { DashboardWsError } from '../dashboard-ws-error';
import { DashboardWsEvent } from '../dashboard-ws-events';
import {
  DASHBOARD_WS_CLOSE_AUTH_FAILED,
  DASHBOARD_WS_CLOSE_FORBIDDEN,
  DASHBOARD_WS_CLOSE_RATE_LIMITED,
  DASHBOARD_WS_CLOSE_SERVER_SHUTDOWN,
  DASHBOARD_WS_CLOSE_TOKEN_EXPIRED,
  DASHBOARD_WS_HEARTBEAT_INTERVAL_MS,
  DASHBOARD_WS_PATH,
  DashboardWsClientFrame,
  DashboardWsErrorCode,
  DashboardWsServerFrame,
} from '../dashboard-ws.constants';
import { DashboardWsConnectionRateLimitService } from '../rate-limit/dashboard-ws-connection-rate-limit.service';
import { DashboardEventsService } from '../realtime/dashboard-events.service';
import { DashboardWsTokenService } from '../tokens/dashboard-ws-token.service';
import { DashboardWsSession } from './dashboard-ws-session.interface';

/**
 * The Livqeno dashboard realtime WebSocket gateway (Phase 5B — see the
 * Phase 5A audit for why this exists and why it is its own gateway rather
 * than reusing Chat or RTC signaling: different consumer, different token,
 * different event vocabulary, and a media/chat connection dropping must
 * not take dashboard realtime down with it, or the other way round —
 * same reasoning chat.gateway.ts gives for staying apart from signaling).
 *
 * A connection authenticates, gets scoped to exactly one project via a
 * signed token claim, subscribes to that project's Redis channel, and
 * answers a heartbeat. Since Phase 5C, it also delivers whatever
 * ConnectionsService/RoomsService publish onto that channel to every local
 * socket holding that project — see dashboard-ws-events.ts for the
 * vocabulary. Every event is a nudge: this gateway never carries a full
 * `Connection`/`Room` record, only enough to tell a client what to refetch
 * over REST (Phase 5A's approved model — REST stays the authoritative
 * snapshot).
 *
 * Like Chat and Signaling, this sidesteps Nest's @SubscribeMessage
 * binding: the wire format is `{"type": "..."}` with flat fields, not
 * Nest's `{"event": ..., "data": ...}`, so clients can use the browser's
 * native WebSocket instead of a framework-specific one.
 */
@WebSocketGateway({ path: DASHBOARD_WS_PATH })
export class DashboardWsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(DashboardWsGateway.name);
  private readonly sessions = new Map<WebSocket, DashboardWsSession>();
  /** projectId -> sockets scoped to it on *this* instance. Turns delivery into a map lookup rather than a scan over every connection this instance holds, same reasoning as ChatGateway's roomIndex. */
  private readonly projectIndex = new Map<string, Set<WebSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;
  private unsubscribeFromEvents?: () => void;

  constructor(
    private readonly tokens: DashboardWsTokenService,
    private readonly events: DashboardEventsService,
    private readonly origins: ProjectOriginService,
    private readonly connectionRateLimit: DashboardWsConnectionRateLimitService,
  ) {}

  afterInit(): void {
    this.unsubscribeFromEvents = this.events.onEvent((envelope) => this.deliverToLocalSockets(envelope));
    this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), DASHBOARD_WS_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    this.logger.log(`Dashboard realtime gateway listening on ${DASHBOARD_WS_PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.unsubscribeFromEvents?.();

    // Close cleanly with a distinct code, so clients know this was a
    // deploy instead of a network failure and can reconnect without
    // climbing the whole backoff ladder.
    for (const [socket, session] of this.sessions) {
      await session.unsubscribe();
      socket.close(DASHBOARD_WS_CLOSE_SERVER_SHUTDOWN, 'server shutting down');
    }
    this.sessions.clear();
    this.projectIndex.clear();
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    // Any frame arriving before our 'message' listener is attached gets
    // dropped in silence, because EventEmitter doesn't buffer for late
    // listeners. So pause until we're ready. Same reasoning as Chat and
    // Signaling.
    socket.pause();

    const clientIp = extractClientIp(request);

    // Rate-limit by IP *before* verifying the token. Otherwise an
    // attacker gets free signature verifications, and that's the
    // expensive part.
    if (!(await this.connectionRateLimit.isAllowed(clientIp))) {
      this.rejectConnection(
        socket,
        new DashboardWsError(DashboardWsErrorCode.RATE_LIMITED, 'Too many connection attempts'),
        DASHBOARD_WS_CLOSE_RATE_LIMITED,
      );
      return;
    }

    let claims;
    try {
      claims = await this.tokens.verify(extractToken(request) ?? '');
    } catch (err) {
      const wsError =
        err instanceof DashboardWsError ? err : new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'Authentication failed');
      // Never log the token, and never forward a raw verifier message.
      this.logger.warn(`dashboard ws authentication rejected from ${clientIp}: ${wsError.wsCode}`);
      this.rejectConnection(
        socket,
        wsError,
        wsError.wsCode === DashboardWsErrorCode.TOKEN_EXPIRED ? DASHBOARD_WS_CLOSE_TOKEN_EXPIRED : DASHBOARD_WS_CLOSE_AUTH_FAILED,
      );
      return;
    }

    // Per-project origin policy. CORS does not apply to a WebSocket
    // upgrade, so this is the only thing standing between a page on an
    // unlisted origin and a dashboard realtime connection — and unlike
    // HTTP, the token is in hand here, so the project is known and the
    // check is genuinely per-tenant. Same guard Chat and Signaling use.
    if (!(await this.origins.isAllowed(claims.pid, request.headers.origin))) {
      this.logger.warn(
        `dashboard ws connection rejected: origin ${request.headers.origin} not allowed for project ${claims.pid}`,
      );
      this.rejectConnection(
        socket,
        new DashboardWsError(
          DashboardWsErrorCode.ORIGIN_NOT_ALLOWED,
          'This origin is not allowed for this project. Add it under Project Settings, Security, Allowed Origins.',
        ),
        DASHBOARD_WS_CLOSE_FORBIDDEN,
      );
      return;
    }

    const connectionId = generateId('dcn');
    // The token's `pid` claim is the *only* input to project scope. There
    // is no client-supplied project id anywhere in this protocol to
    // reconcile against or accidentally trust (Phase 5A §8).
    const unsubscribe = await this.events.subscribe(claims.pid);

    const session: DashboardWsSession = {
      connectionId,
      projectId: claims.pid,
      userId: claims.sub,
      tokenId: claims.jti,
      tokenExpiresAt: claims.exp * 1000,
      socket,
      unsubscribe,
      isAlive: true,
      connectedAt: new Date(),
    };

    this.sessions.set(socket, session);
    this.addToProjectIndex(session.projectId, socket);

    socket.on('message', (data: RawData) => void this.handleFrame(session, data));
    socket.on('pong', () => {
      session.isAlive = true;
    });
    socket.on('error', (err: Error) => {
      this.logger.warn(`dashboard ws socket error on ${connectionId}: ${err.message}`);
    });

    this.send(socket, {
      type: DashboardWsServerFrame.CONNECTED,
      connectionId,
      projectId: session.projectId,
      // Told up front, so the client can refresh before the socket gets
      // closed out from under it, not discovering expiry the hard way.
      expiresAt: new Date(session.tokenExpiresAt).toISOString(),
      heartbeatIntervalMs: DASHBOARD_WS_HEARTBEAT_INTERVAL_MS,
    });

    socket.resume();
    this.logger.log(`dashboard ws connected: ${connectionId} user=${session.userId} project=${session.projectId}`);
  }

  async handleDisconnect(socket: WebSocket): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    this.removeFromProjectIndex(session.projectId, socket);
    await session.unsubscribe();
    this.logger.log(`dashboard ws disconnected: ${session.connectionId} user=${session.userId}`);
  }

  // -------------------------------------------------------------------------
  // Fan-out
  // -------------------------------------------------------------------------

  /**
   * Runs for every event on every project this instance subscribes to.
   * Delivery is a map lookup against the local project index, never a scan
   * over every connection this instance holds — same reasoning as
   * ChatGateway.deliverToLocalSockets.
   */
  private deliverToLocalSockets(envelope: { projectId: string; event: DashboardWsEvent }): void {
    const sockets = this.projectIndex.get(envelope.projectId);
    if (!sockets || sockets.size === 0) return;

    for (const socket of sockets) {
      // The event itself already carries its own `type` field (see
      // dashboard-ws-events.ts) — it IS the frame, no extra envelope
      // wrapper for the client to unwrap.
      this.send(socket, envelope.event as unknown as Record<string, unknown>);
    }
  }

  // -------------------------------------------------------------------------
  // Frame handling — heartbeat only in this phase
  // -------------------------------------------------------------------------

  private async handleFrame(session: DashboardWsSession, data: RawData): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.send(
        session.socket,
        new DashboardWsError(DashboardWsErrorCode.INVALID_MESSAGE_TYPE, 'Frame is not valid JSON').toFrame(),
      );
      return;
    }

    const type = (parsed as { type?: unknown } | null)?.type;
    const id = (parsed as { id?: unknown } | null)?.id;

    if (type === DashboardWsClientFrame.PING) {
      this.send(session.socket, { type: DashboardWsServerFrame.PONG, id: typeof id === 'string' ? id : undefined });
      return;
    }

    // Phase 5B carries no other client-sendable frame. Anything else is a
    // protocol error rather than a silently-dropped message: a client
    // sending the wrong thing should find out, not wonder why nothing
    // happened.
    this.send(
      session.socket,
      new DashboardWsError(DashboardWsErrorCode.INVALID_MESSAGE_TYPE, 'Unsupported frame type').toFrame(),
    );
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  /**
   * One pass, two jobs: kill sockets that missed a pong, and close
   * sockets whose token has expired. Same structure as
   * ChatGateway.runHeartbeat, minus the presence/TTL refresh work this
   * plane has no ephemeral state to refresh yet.
   */
  private async runHeartbeat(): Promise<void> {
    const now = Date.now();

    for (const [socket, session] of this.sessions) {
      if (!session.isAlive) {
        this.logger.warn(`terminating unresponsive dashboard ws connection ${session.connectionId}`);
        await session.unsubscribe();
        this.sessions.delete(socket);
        this.removeFromProjectIndex(session.projectId, socket);
        socket.terminate();
        continue;
      }

      // A socket that authenticated a while ago mustn't stay open forever
      // on a token that has since expired.
      if (session.tokenExpiresAt <= now) {
        this.logger.log(`closing dashboard ws connection ${session.connectionId}: token expired`);
        this.send(
          socket,
          new DashboardWsError(DashboardWsErrorCode.TOKEN_EXPIRED, 'Dashboard WS token expired — reconnect with a new one').toFrame(),
        );
        await session.unsubscribe();
        this.sessions.delete(socket);
        this.removeFromProjectIndex(session.projectId, socket);
        socket.close(DASHBOARD_WS_CLOSE_TOKEN_EXPIRED, 'token expired');
        continue;
      }

      session.isAlive = false;
      socket.ping();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private addToProjectIndex(projectId: string, socket: WebSocket): void {
    const sockets = this.projectIndex.get(projectId);
    if (sockets) {
      sockets.add(socket);
    } else {
      this.projectIndex.set(projectId, new Set([socket]));
    }
  }

  private removeFromProjectIndex(projectId: string, socket: WebSocket): void {
    const sockets = this.projectIndex.get(projectId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.projectIndex.delete(projectId);
    }
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  private rejectConnection(socket: WebSocket, error: DashboardWsError, closeCode: number): void {
    this.send(socket, error.toFrame());
    socket.resume();
    socket.close(closeCode, error.wsCode);
  }

  /** Live counts, for /health and metrics. */
  getMetrics() {
    return {
      activeConnections: this.sessions.size,
      subscribedProjectChannels: this.events.getSubscribedChannelCount(),
    };
  }
}

function extractToken(request: IncomingMessage): string | null {
  // Query param rather than a header, because the browser WebSocket API
  // can't set headers on an upgrade. Same trade Chat and Signaling make,
  // and why dashboard WS tokens are short-lived and revocable: a URL can
  // end up in a proxy log.
  const url = new URL(request.url ?? '', 'http://localhost');
  return url.searchParams.get('token');
}

function extractClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}
