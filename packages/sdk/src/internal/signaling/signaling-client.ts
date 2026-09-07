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
 * How long to wait for the socket to open, and for `room.joined` after it.
 *
 * Separate from each other because they fail for different reasons: the
 * first is "cannot reach the API", the second is "the API cannot reach an
 * RTC server". A single combined timeout would report both as the same
 * thing.
 */
const OPEN_TIMEOUT_MS = 10_000;
const JOIN_TIMEOUT_MS = 15_000;

/** Reconnect backoff. Jittered, so a fleet-wide blip does not produce a thundering herd. */
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
  /** The socket opened and the room was joined. Fires again after each successful reconnect. */
  joined: (payload: JoinedPayload) => void;
  message: (message: ServerMessage) => void;
  /** Connection lost; a reconnect is being attempted. */
  reconnecting: () => void;
  /** Reconnect attempts exhausted, or the failure is not retryable. */
  failed: (error: RTCError) => void;
  /** Closed deliberately, by `close()`. */
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
   * Supplies a fresh token when the current one is close to expiry or has
   * been rejected (spec §21). Without it, a call outlives its token and
   * dies at the next reconnect.
   */
  refreshToken?: () => Promise<string>;
}

/**
 * The SDK's signaling connection.
 *
 * # What this owns and what it does not
 *
 * It owns the socket, the join handshake, and reconnection. It does not
 * know what a `PeerConnection` is: every message is handed to the adapter,
 * which decides what to negotiate. Keeping that line clean is what makes
 * the reconnect logic testable without a WebRTC stack, and what lets the
 * React Native and Flutter clients reuse the same protocol reasoning
 * against a different transport.
 *
 * # Reconnection
 *
 * Reconnecting re-runs the whole join, because that is what the server
 * expects: the previous session's PeerConnection is gone (or being reaped),
 * and `room.join` allocates a fresh one. The adapter rebuilds its
 * PeerConnection from the offer that follows. That is more work than
 * resuming a session, and it is chosen deliberately — an ICE restart on a
 * connection that has already failed is less reliable than starting clean,
 * and the client has to handle a fresh session anyway when the network
 * changed underneath it (spec §20).
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
   * Resolves once `room.joined` arrives — not merely once the socket
   * opens. A caller that got a resolved promise on socket-open would then
   * have to wait for an event to know whether it was actually in the room,
   * which is the same waiting with an extra step.
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
        // A browser WebSocket error event carries no detail, by design —
        // exposing why a connection failed would be a cross-origin
        // information leak. So the message says what to check rather than
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

        // The join handshake is resolved here, then every subsequent
        // message goes to the steady-state handler below.
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
        // Post-open errors are followed by a close event, which is where
        // reconnection is decided. Nothing to do here but avoid an
        // unhandled event.
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
      // Fatal errors end the session; retryable ones are the adapter's
      // problem (a glare, say, which it resolves by retrying its offer).
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

    // 4001 is the server's authentication-failed close code. Reconnecting
    // with the same rejected token would just fail again — so a refresh is
    // attempted first, and only then a reconnect.
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
      // Refreshed on the first attempt too, not only after an auth
      // failure: a reconnect after a long network outage very often has an
      // expired token, and discovering that by being rejected costs an
      // extra round trip and a confusing log line.
      await this.tryRefreshToken();
    }

    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    // Full jitter: every client picks somewhere in [0, backoff), so a
    // fleet that all dropped at once does not all retry at once.
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
      // Not fatal on its own: the existing token may still be valid, and
      // failing the reconnect here would turn a recoverable blip into a
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
      // Dropped rather than queued. Every message here describes a moment
      // in a negotiation, and replaying a stale answer after a reconnect
      // would be worse than never sending it — the reconnect re-joins and
      // negotiates afresh.
      this.logger.debug('dropping signaling message, socket not open', message.type);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  /** Leaves the room and closes the socket. Suppresses reconnection. */
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
    // The token goes in a query parameter because the browser's WebSocket
    // API cannot set request headers. It is short-lived by design for
    // exactly this reason, and the connection must be wss:// in
    // production — which the server's own config validation enforces.
    return `${base}?token=${encodeURIComponent(this.token)}`;
  }

  private parse(data: unknown): ServerMessage | undefined {
    if (typeof data !== 'string') {
      // Raven's signaling is text-only. A binary frame means something
      // else is on this socket, and guessing at it would be worse than
      // ignoring it.
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
      case 'ROOM_NOT_FOUND':
        return new RTCError('ROOM_NOT_FOUND', message);
      case 'UNAUTHORIZED':
      case 'PERMISSION_DENIED':
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
