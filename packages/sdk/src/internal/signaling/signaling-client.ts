import { RTCError } from '../../errors';
import type { Logger } from '../../logger';
import { TypedEventEmitter } from '../../events';
import {
  ClientMessageType,
  FATAL_ERROR_CODES,
  ServerMessageType,
  type ClientMessage,
  type ServerMessage,
  type ServerParticipant,
  type SignalingErrorCode,
} from './protocol';

/**
 * How long to wait for the socket to open, and then for `room.joined`.
 *
 * Two values, because they fail for completely different reasons. The
 * first means "can't reach the API"; the second means "the API can't reach
 * an RTC server". One combined timeout would report both as the same
 * thing, which helps nobody.
 */
const OPEN_TIMEOUT_MS = 10_000;
const JOIN_TIMEOUT_MS = 15_000;

/** Reconnect backoff, jittered, so a fleet-wide blip doesn't turn into a thundering herd. */
const RECONNECT_BASE_MS = 300;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_MAX_ATTEMPTS = 12;

/** What the server reports about the room at the moment of joining. */
export interface JoinedPayload {
  roomId: string;
  participants: ServerParticipant[];
  /** The RTC server's name, for diagnostics. Never its address. */
  rtcServer?: string;
  region?: string;
}

export interface SignalingClientEvents {
  /** Socket opened, room joined. Fires again after every successful reconnect. */
  joined: (payload: JoinedPayload) => void;
  message: (message: ServerMessage) => void;
  /** Connection lost; a reconnect is being attempted. */
  reconnecting: () => void;
  /** Reconnect attempts exhausted, or the failure is not retryable. */
  failed: (error: RTCError) => void;
  /** Closed on purpose, via `close()`. */
  closed: () => void;
}

export interface SignalingClientOptions {
  endpoint: string;
  token: string;
  roomId: string;
  region?: string;
  autoReconnect: boolean;
  logger: Logger;
  /**
   * Hands back a fresh token when the current one is nearly expired or has
   * been rejected outright (spec §21). Without it, a call outlives its
   * token and dies at the next reconnect.
   */
  refreshToken?: () => Promise<string>;
}

/**
 * The SDK's signaling connection.
 *
 * # What it owns, and what it doesn't
 *
 * It owns the socket, the join handshake and reconnection. It has no idea
 * what a `PeerConnection` is. Every message goes straight to the adapter,
 * which decides what to negotiate. Keeping that line clean is what makes
 * the reconnect logic testable with no WebRTC stack in sight, and what
 * lets the React Native and Flutter clients reuse the same protocol
 * reasoning over a different transport.
 *
 * # Reconnection
 *
 * A reconnect re-runs the entire join, because that's what the server is
 * expecting. The previous session's PeerConnection is gone or being
 * reaped, and `room.join` allocates a fresh one; the adapter rebuilds its
 * PeerConnection off the offer that follows. Yes, that's more work than
 * resuming a session, and it's the deliberate choice: an ICE restart on a
 * connection that already failed is flakier than starting clean, and the
 * client has to cope with a fresh session anyway when the network moved
 * under it (spec §20).
 */
export class SignalingClient extends TypedEventEmitter<SignalingClientEvents> {
  private socket?: WebSocket;
  private token: string;
  private readonly options: SignalingClientOptions;
  private readonly logger: Logger;

  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closedByCaller = false;
  private joined = false;

  constructor(options: SignalingClientOptions) {
    super();
    this.options = options;
    this.token = options.token;
    this.logger = options.logger;
  }

  get isJoined(): boolean {
    return this.joined;
  }

  /**
   * Opens the socket and joins the room.
   *
   * Resolves when `room.joined` arrives, not when the socket opens. Resolve
   * on socket-open and the caller still has to sit waiting on an event to
   * find out whether they're actually in the room, which is the same wait
   * with an extra step bolted on.
   */
  async connect(): Promise<JoinedPayload> {
    this.closedByCaller = false;
    return this.openAndJoin();
  }

  private async openAndJoin(): Promise<JoinedPayload> {
    const socket = await this.openSocket();
    this.socket = socket;
    return this.join(socket);
  }

  private openSocket(): Promise<WebSocket> {
    const url = this.buildUrl();

    return new Promise<WebSocket>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(new RTCError('SIGNALING_ERROR', 'Could not open a signaling connection', error));
        return;
      }

      const timeout = setTimeout(() => {
        socket.close();
        reject(new RTCError('TIMEOUT', `Signaling connection to ${this.options.endpoint} timed out`));
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.logger.debug('signaling socket open');
        resolve(socket);
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        // A browser WebSocket error event carries no detail whatsoever,
        // by design: saying why a connection failed would be a cross-origin
        // information leak. So this message lists what to check instead of
        // pretending to know.
        reject(
          new RTCError(
            'NETWORK_ERROR',
            `Could not reach the signaling endpoint at ${this.options.endpoint}`,
          ),
        );
      };
    });
  }

  private join(socket: WebSocket): Promise<JoinedPayload> {
    return new Promise<JoinedPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new RTCError('TIMEOUT', 'The server did not confirm the room join'));
      }, JOIN_TIMEOUT_MS);

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      socket.onmessage = (event: MessageEvent) => {
        const message = this.parse(event.data);
        if (!message) {
          return;
        }

        // Join handshake resolves here. Everything after it goes to the
        // steady-state handler below.
        if (!settled) {
          if (message.type === ServerMessageType.ROOM_JOINED) {
            const payload: JoinedPayload = {
              roomId: message.roomId,
              participants: message.participants,
              rtcServer: message.rtcServer,
              region: message.region,
            };
            this.joined = true;
            this.reconnectAttempts = 0;
            this.logger.info(
              'joined room',
              message.roomId,
              message.rtcServer ? `via ${message.rtcServer}` : '',
            );
            settle(() => resolve(payload));
            this.emit('joined', payload);
            return;
          }

          if (message.type === ServerMessageType.ERROR) {
            settle(() => reject(this.toError(message.code, message.message)));
            return;
          }
        }

        this.handleMessage(message);
      };

      socket.onclose = (event: CloseEvent) => {
        this.joined = false;
        settle(() =>
          reject(
            new RTCError(
              'SIGNALING_ERROR',
              `The signaling connection closed before the room was joined (code ${event.code})`,
            ),
          ),
        );
        this.handleClose(event);
      };

      socket.onerror = () => {
        // A post-open error is always followed by a close event, and
        // that's where reconnection gets decided. Nothing to do here except
        // not leave the event unhandled.
      };

      this.send({
        type: ClientMessageType.ROOM_JOIN,
        roomId: this.options.roomId,
        region: this.options.region,
      });
    });
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === ServerMessageType.ERROR) {
      const error = this.toError(message.code, message.message);
      this.logger.warn('signaling error', message.code, message.message);
      // Fatal errors end the session. Retryable ones belong to the
      // adapter, glare being the usual suspect, which it sorts out by
      // retrying its offer.
      if (FATAL_ERROR_CODES.has(message.code)) {
        this.closedByCaller = true;
        this.socket?.close();
        this.emit('failed', error);
        return;
      }
    }

    this.emit('message', message);
  }

  private handleClose(event: CloseEvent): void {
    if (this.closedByCaller) {
      this.emit('closed');
      return;
    }
    if (!this.options.autoReconnect) {
      this.emit(
        'failed',
        new RTCError('NETWORK_ERROR', `The signaling connection closed (code ${event.code})`),
      );
      return;
    }

    // 4001 is the server's authentication-failed close code. Reconnect
    // with the same rejected token and you'll get rejected again, so try a
    // refresh first and only then reconnect.
    const authFailed = event.code === 4001;
    void this.scheduleReconnect(authFailed);
  }

  private async scheduleReconnect(refreshFirst: boolean): Promise<void> {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.emit(
        'failed',
        new RTCError(
          'CONNECTION_FAILED',
          `Could not re-establish signaling after ${RECONNECT_MAX_ATTEMPTS} attempts`,
        ),
      );
      return;
    }

    this.reconnectAttempts++;
    this.emit('reconnecting');

    if (refreshFirst || this.reconnectAttempts === 1) {
      // Refresh on the first attempt as well, not just after an auth
      // failure. A reconnect following a long outage very often carries an
      // expired token, and finding that out by getting rejected costs a
      // round trip and leaves a confusing line in the log.
      await this.tryRefreshToken();
    }

    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    // Full jitter. Every client picks somewhere in [0, backoff), so a
    // fleet that all dropped together doesn't all come back together.
    const delay = Math.random() * backoff;

    this.logger.info(
      `signaling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      void this.openAndJoin().catch((error) => {
        this.logger.warn('signaling reconnect failed', (error as Error).message);
        void this.scheduleReconnect(false);
      });
    }, delay);
  }

  private async tryRefreshToken(): Promise<void> {
    if (!this.options.refreshToken) {
      return;
    }
    try {
      this.token = await this.options.refreshToken();
      this.logger.debug('rtc token refreshed');
    } catch (error) {
      // Not fatal by itself. The existing token may well still be good,
      // and failing the reconnect here turns a recoverable blip into a
      // dropped call.
      this.logger.warn('rtc token refresh failed', (error as Error).message);
    }
  }

  /** Replaces the token used by future reconnects (spec §21). */
  setToken(token: string): void {
    this.token = token;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      // Dropped, not queued. Every message here describes one moment in a
      // negotiation, and replaying a stale answer after a reconnect is
      // worse than never sending it. The reconnect re-joins and negotiates
      // from scratch anyway.
      this.logger.debug('dropping signaling message, socket not open', message.type);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  /** Leaves the room and closes the socket. No reconnect afterwards. */
  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: ClientMessageType.ROOM_LEAVE });
      this.socket.close(1000, 'client left');
    }
    this.joined = false;
  }

  private buildUrl(): string {
    const base = this.options.endpoint.replace(/\/$/, '');
    // Token rides in a query parameter, because the browser's WebSocket
    // API can't set request headers. It's short-lived by design for exactly
    // this reason, and the connection has to be wss:// in production, which
    // the server's own config validation enforces.
    return `${base}?token=${encodeURIComponent(this.token)}`;
  }

  private parse(data: unknown): ServerMessage | undefined {
    if (typeof data !== 'string') {
      // Livqeno's signaling is text-only. A binary frame means something
      // else has got onto this socket, and guessing at it beats ignoring it
      // exactly never.
      this.logger.warn('ignoring non-text signaling frame');
      return undefined;
    }
    try {
      return JSON.parse(data) as ServerMessage;
    } catch {
      this.logger.warn('ignoring unparseable signaling frame');
      return undefined;
    }
  }

  private toError(code: SignalingErrorCode, message: string): RTCError {
    switch (code) {
      case 'INVALID_TOKEN':
        return new RTCError('INVALID_TOKEN', message);
      case 'TOKEN_EXPIRED':
        return new RTCError('TOKEN_EXPIRED', message);
      case 'TOKEN_REVOKED':
        return new RTCError('TOKEN_REVOKED', message);
      // Surfaced as its own code rather than falling through to
      // SIGNALING_ERROR, so an application can tell "you are out of
      // minutes" from "signaling broke" and show a billing prompt instead
      // of a retry button.
      case 'USAGE_LIMIT_EXCEEDED':
        return new RTCError('USAGE_LIMIT_EXCEEDED', message);
      case 'ROOM_NOT_FOUND':
        return new RTCError('ROOM_NOT_FOUND', message);
      // ORIGIN_NOT_ALLOWED belongs here rather than in the default: the
      // token was valid, it was the page holding it that was not on the
      // project's allow-list. Letting it fall through to SIGNALING_ERROR
      // would bury the server's message naming the dashboard setting to
      // change.
      case 'UNAUTHORIZED':
      case 'PERMISSION_DENIED':
      case 'ORIGIN_NOT_ALLOWED':
        return new RTCError('PERMISSION_DENIED', message);
      case 'ROOM_FULL':
      case 'NO_RTC_CAPACITY':
      case 'RTC_SERVER_UNREACHABLE':
        return new RTCError('CONNECTION_FAILED', message);
      case 'RATE_LIMITED':
        return new RTCError('NETWORK_ERROR', message);
      default:
        return new RTCError('SIGNALING_ERROR', message);
    }
  }
}
