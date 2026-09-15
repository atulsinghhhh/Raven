import { backoffDelayMs } from './backoff';

/** The slice of the WebSocket API this transport actually uses. Injectable, so tests can drive a fake socket with no real server. */
export interface DashboardRealtimeSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type DashboardRealtimeSocketFactory = (url: string) => DashboardRealtimeSocketLike;

export interface DashboardRealtimeTransportOptions {
  /** The wss:// URL the mint endpoint returned. Never a fixed env var — see apps/api's DashboardWsTokenService.wsUrl. */
  wsUrl: string;
  token: string;
  maxReconnectAttempts: number;
  initialReconnectDelayMs: number;
  maxReconnectDelayMs: number;
  socketFactory?: DashboardRealtimeSocketFactory;
}

export interface DashboardRealtimeCloseInfo {
  code: number;
  reason: string;
  willReconnect: boolean;
  /** Retrying could never have helped anyway (a rejected token, a disallowed origin) — distinct from merely giving up after exhausting attempts. */
  terminal: boolean;
}

export interface DashboardRealtimeTransportHandlers {
  onFrame: (frame: Record<string, unknown>) => void;
  onOpen: () => void;
  onClose: (info: DashboardRealtimeCloseInfo) => void;
  onReconnecting: (attempt: number, delayMs: number) => void;
  onError: (message: string) => void;
}

/**
 * Close codes the gateway sends for failures retrying can't fix. Mirrors
 * apps/api's DASHBOARD_WS_CLOSE_* constants — kept as literals here since
 * the dashboard doesn't share a package with the API.
 */
const TERMINAL_CLOSE_CODES = new Set([
  4801, // auth failed
  4803, // origin not allowed
]);
/** Token expiry is recoverable: the transport refreshes and retries. */
const TOKEN_EXPIRED_CLOSE_CODE = 4840;
const NORMAL_CLOSURE = 1000;

/**
 * Owns the dashboard realtime WebSocket and its reconnect policy. Nothing
 * else — no frame parsing beyond JSON, no product-event handling. Ported
 * from packages/chat-sdk/src/internal/socket-transport.ts's proven
 * reconnect behavior (Phase 5B instructions: copy it rather than invent
 * new retry semantics), trimmed to what a heartbeat-only transport needs.
 */
export class DashboardRealtimeTransport {
  private socket?: DashboardRealtimeSocketLike;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  /** Set when the caller asked to disconnect, so we don't "helpfully" reconnect anyway. */
  private intentionallyClosed = false;
  private token: string;

  constructor(
    private readonly options: DashboardRealtimeTransportOptions,
    private readonly handlers: DashboardRealtimeTransportHandlers,
  ) {
    this.token = options.token;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  /** Swaps in a refreshed token. The next connect or reconnect uses it — used when a TOKEN_EXPIRED close is about to trigger a reopen. */
  setToken(token: string): void {
    this.token = token;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.open();
  }

  send(frame: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  disconnect(code = NORMAL_CLOSURE, reason = 'client disconnect'): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.attempt = 0;
    // Detach handlers before closing, or the close event fires the very
    // reconnect path we just cancelled.
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close(code, reason);
      } catch {
        // Already closing or closed. Nothing to do.
      }
    }
  }

  private open(): void {
    const factory = this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as DashboardRealtimeSocketLike);

    // Token rides in the query string because the browser WebSocket API
    // can't set headers on an upgrade. Same trade Chat and RTC make.
    const url = `${this.options.wsUrl}?token=${encodeURIComponent(this.token)}`;

    let socket: DashboardRealtimeSocketLike;
    try {
      socket = factory(url);
    } catch {
      this.handlers.onError('Could not open a dashboard realtime connection');
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onOpen();
    };

    socket.onmessage = (event) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handlers.onFrame(frame);
    };

    socket.onerror = () => {
      // Browsers give no detail here on purpose; the close event that
      // follows carries the actual reason.
    };

    socket.onclose = (event) => {
      this.socket = undefined;

      if (this.intentionallyClosed) {
        this.handlers.onClose({ code: event.code, reason: event.reason, willReconnect: false, terminal: false });
        return;
      }

      const terminal = TERMINAL_CLOSE_CODES.has(event.code);
      const attemptsExhausted = this.attempt >= this.options.maxReconnectAttempts;
      const willReconnect = !terminal && !attemptsExhausted;

      // Close first, then error. A consumer decides failed vs.
      // disconnected off `terminal`, and an error emitted before that
      // decision just gets overwritten by it.
      this.handlers.onClose({
        code: event.code,
        reason: event.reason,
        willReconnect,
        terminal: terminal || attemptsExhausted,
      });

      if (terminal) {
        this.handlers.onError(event.reason || 'The dashboard realtime connection was rejected');
        return;
      }

      if (willReconnect) {
        this.scheduleReconnect();
        return;
      }

      // Ran out of attempts. Say so out loud instead of going quiet. A
      // client that silently stops retrying looks exactly like one
      // that's still trying.
      this.handlers.onError(`Could not reconnect after ${this.options.maxReconnectAttempts} attempts`);
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) {
      return;
    }
    if (this.attempt >= this.options.maxReconnectAttempts) {
      this.handlers.onError(`Could not reconnect after ${this.options.maxReconnectAttempts} attempts`);
      return;
    }

    this.attempt += 1;
    const delayMs = backoffDelayMs(this.attempt, this.options.initialReconnectDelayMs, this.options.maxReconnectDelayMs);

    this.handlers.onReconnecting(this.attempt, delayMs);

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.open();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export { TOKEN_EXPIRED_CLOSE_CODE };
