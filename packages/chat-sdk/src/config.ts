import { RavenChatAuthenticationError } from './errors';
import type { LogLevel } from './logger';

export interface ChatClientConfig {
  /**
   * The chat token your backend minted via `POST /v1/chat/tokens`. Never
   * mint one in the browser, and never put a project API key here.
   */
  token: string;
  /**
   * WebSocket URL — the `chatUrl` field from the same mint response.
   * Optional: the SDK derives it from the token's issuer when omitted, so
   * the common case is just `createChatClient({ token })`.
   */
  chatUrl?: string;
  /** REST base for history and attachments — the `apiUrl` from the same response. */
  apiUrl?: string;
  logLevel?: LogLevel;
  /** Defaults to true. Set false to handle reconnection yourself. */
  autoReconnect?: boolean;
  /**
   * Cap on reconnect attempts before giving up and going `failed`.
   * Defaults to 10. Delay is exponential with jitter, capped at
   * `maxReconnectDelayMs` — never an unbounded retry loop (spec §11).
   */
  maxReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** How long to wait for a server ack before rejecting a send. Defaults to 15s. */
  requestTimeoutMs?: number;
  /**
   * Called when the token is about to expire, so the app can fetch a
   * fresh one from its own backend. Return the new token and the SDK
   * reconnects with it — without this, the socket simply closes at expiry
   * and the developer has to notice.
   */
  onTokenExpiring?: () => Promise<string> | string;
}

export interface ResolvedChatClientConfig {
  token: string;
  chatUrl: string;
  apiUrl: string;
  logLevel: LogLevel;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  initialReconnectDelayMs: number;
  maxReconnectDelayMs: number;
  requestTimeoutMs: number;
  onTokenExpiring?: () => Promise<string> | string;
}

export interface ChatTokenPayload {
  sub: string;
  pid: string;
  cvs: string[];
  scopes: string[];
  exp: number;
  jti: string;
}

/**
 * Reads the token's payload. Does not verify it — the server is the only
 * thing whose opinion counts. This exists so the SDK can fail fast on an
 * already-expired token and know its own user id without a round-trip.
 */
export function decodeChatToken(token: string): ChatTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new RavenChatAuthenticationError('Chat token is malformed (expected a JWT with 3 parts)');
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as ChatTokenPayload;
    if (!payload.sub || !payload.pid || typeof payload.exp !== 'number') {
      throw new Error('missing claims');
    }
    return payload;
  } catch (error) {
    throw new RavenChatAuthenticationError('Chat token payload could not be decoded', 'INVALID_TOKEN', error);
  }
}

export function validateConfig(config: ChatClientConfig): ResolvedChatClientConfig {
  if (!config || typeof config !== 'object') {
    throw new RavenChatAuthenticationError('createChatClient(config) requires a configuration object');
  }
  if (!config.token || typeof config.token !== 'string') {
    throw new RavenChatAuthenticationError(
      'config.token is required — the chat token your backend minted via POST /v1/chat/tokens',
    );
  }

  const payload = decodeChatToken(config.token);
  if (payload.exp * 1000 <= Date.now()) {
    throw new RavenChatAuthenticationError('Chat token has already expired', 'TOKEN_EXPIRED');
  }

  const chatUrl = config.chatUrl ?? deriveChatUrl(config.apiUrl);
  if (!chatUrl) {
    throw new RavenChatAuthenticationError(
      'config.chatUrl is required — the "chatUrl" field from the same response as config.token',
    );
  }

  return {
    token: config.token,
    chatUrl,
    apiUrl: config.apiUrl ?? deriveApiUrl(chatUrl),
    logLevel: config.logLevel ?? 'silent',
    autoReconnect: config.autoReconnect ?? true,
    maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
    initialReconnectDelayMs: config.initialReconnectDelayMs ?? 500,
    maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30_000,
    requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
    onTokenExpiring: config.onTokenExpiring,
  };
}

/** `https://api.example.com` -> `wss://api.example.com/v1/chat/ws` */
function deriveChatUrl(apiUrl?: string): string | undefined {
  if (!apiUrl) return undefined;
  const ws = apiUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return `${ws}/v1/chat/ws`;
}

/** The inverse, so passing only `chatUrl` still gets you working REST calls. */
function deriveApiUrl(chatUrl: string): string {
  return chatUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/v1\/chat\/ws$/, '');
}
