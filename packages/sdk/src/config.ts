import { RTCError } from './errors';
import type { LogLevel } from './logger';

export interface RTCClientConfig {
  /** The RTC token your backend minted through Raven's Control API. Never mint one in the browser. */
  token: string;
  /**
   * RTC infrastructure URL to connect to. It's the `endpoint` field out of
   * the same mint response as `token`. Forward both through untouched;
   * don't build this by hand.
   */
  endpoint: string;
  /**
   * The `iceServers` array from the same mint response. Optional so tests
   * and advanced setups can skip it, but ordinarily you just forward it.
   * Don't go configuring STUN/TURN by hand.
   */
  iceServers?: RTCIceServer[];
  logLevel?: LogLevel;
  /** Defaults to true. Set false to disable automatic reconnect on network loss. */
  autoReconnect?: boolean;
  /**
   * Base URL for best-effort connection telemetry. Comes from the
   * `telemetryUrl` field of the same token-mint response as `token` and
   * `endpoint`; never build it yourself. Leave it out, or set
   * `telemetry: false`, to turn telemetry off completely. RTC never
   * depends on it either way. See docs/telemetry.md.
   */
  telemetryUrl?: string;
  /** Defaults to true. Set false to switch telemetry off; RTC never needs it (Phase 9 spec §31). */
  telemetry?: boolean;
}

export interface ResolvedRTCClientConfig {
  token: string;
  endpoint: string;
  iceServers?: RTCIceServer[];
  logLevel: LogLevel;
  autoReconnect: boolean;
  telemetryUrl?: string;
  telemetry: boolean;
}

interface DecodedTokenPayload {
  room?: string;
  exp?: number;
  sub?: string;
}

/** Decodes the JWT payload. Doesn't verify it; the server is the source of truth. */
export function decodeTokenPayload(token: string): DecodedTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new RTCError('INVALID_TOKEN', 'RTC token is malformed (expected a JWT with 3 parts)');
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64));
    return {
      room: json?.video?.room,
      exp: typeof json?.exp === 'number' ? json.exp : undefined,
      sub: typeof json?.sub === 'string' ? json.sub : undefined,
    };
  } catch (error) {
    throw new RTCError('INVALID_TOKEN', 'RTC token payload could not be decoded', error);
  }
}

export function validateConfig(config: RTCClientConfig): ResolvedRTCClientConfig {
  if (!config || typeof config !== 'object') {
    throw new RTCError('INVALID_TOKEN', 'createRTCClient(config) requires a configuration object');
  }
  if (!config.token || typeof config.token !== 'string') {
    throw new RTCError('INVALID_TOKEN', 'config.token is required; the RTC token from your backend');
  }
  if (!config.endpoint || typeof config.endpoint !== 'string') {
    throw new RTCError(
      'INVALID_TOKEN',
      'config.endpoint is required; the "endpoint" field from the same token-mint response as config.token',
    );
  }

  const { exp } = decodeTokenPayload(config.token);
  if (exp !== undefined && exp * 1000 <= Date.now()) {
    throw new RTCError('TOKEN_EXPIRED', 'RTC token has already expired');
  }

  return {
    token: config.token,
    endpoint: config.endpoint,
    iceServers: config.iceServers,
    logLevel: config.logLevel ?? 'silent',
    autoReconnect: config.autoReconnect ?? true,
    telemetryUrl: config.telemetryUrl,
    telemetry: config.telemetry ?? true,
  };
}

/**
 * Bails out client-side, before any connection is attempted, if the token
 * was minted for a different room than the one being joined. Much clearer
 * than letting the connection fail and working backwards from that.
 */
export function assertTokenMatchesRoom(token: string, roomId: string): void {
  const { room } = decodeTokenPayload(token);
  if (room && room !== roomId) {
    throw new RTCError('ROOM_NOT_FOUND', `This token was minted for room "${room}", not "${roomId}"`);
  }
}
