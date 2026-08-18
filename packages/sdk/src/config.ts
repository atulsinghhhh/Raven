import { RTCError } from './errors';
import type { LogLevel } from './logger';

export interface RTCClientConfig {
  /** The RTC token minted by your backend via Raven's Control API. Never mint this in the browser. */
  token: string;
  /**
   * RTC infrastructure URL to connect to — the `livekitUrl` field from
   * the same mint response as `token`. Forward both through as-is, don't
   * hand-construct this.
   */
  endpoint: string;
  /**
   * `iceServers` array from the same mint response. Optional so tests
   * and advanced setups can skip it, but normally just forward it —
   * don't hand-configure STUN/TURN yourself.
   */
  iceServers?: RTCIceServer[];
  logLevel?: LogLevel;
  /** Defaults to true. Set false to disable automatic reconnect on network loss. */
  autoReconnect?: boolean;
  /**
   * Base URL for best-effort connection telemetry — the `telemetryUrl`
   * field from the same token-mint response as `token`/`endpoint`. Never
   * hand-construct this. Omit it (or set `telemetry: false`) to disable
   * telemetry entirely; RTC itself never depends on it either way. See
   * docs/telemetry.md.
   */
  telemetryUrl?: string;
  /** Defaults to true. Set false to disable telemetry — never required for RTC to work (Phase 9 spec §31). */
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

/** Decodes the JWT payload — doesn't verify it, the server's the source of truth. */
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
    throw new RTCError('INVALID_TOKEN', 'config.token is required — the RTC token from your backend');
  }
  if (!config.endpoint || typeof config.endpoint !== 'string') {
    throw new RTCError(
      'INVALID_TOKEN',
      'config.endpoint is required — the "livekitUrl" field from the same token-mint response as config.token',
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
 * Fails fast client-side, before attempting any connection, if the
 * token was minted for a different room than the one being joined —
 * clearer than letting the connection itself fail.
 */
export function assertTokenMatchesRoom(token: string, roomId: string): void {
  const { room } = decodeTokenPayload(token);
  if (room && room !== roomId) {
    throw new RTCError('ROOM_NOT_FOUND', `This token was minted for room "${room}", not "${roomId}"`);
  }
}
