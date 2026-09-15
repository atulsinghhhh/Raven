// Wire protocol + shared vocabulary for the Livqeno dashboard realtime
// transport (Phase 5B). Same arrangement as chat.constants.ts and
// signaling.constants.ts.
//
// Phase 5B is transport-only: token issuance, authenticated connection,
// project scoping, heartbeat, clean disconnect. The only frames that exist
// right now are a connection handshake and a ping/pong heartbeat — no
// product event has been wired onto this channel yet. Later phases add
// server-emitted event frames (connection.state_changed, room.created,
// etc.) without changing anything here.

/** Frames a client may send. Anything else is rejected as INVALID_MESSAGE_TYPE. */
export enum DashboardWsClientFrame {
  PING = 'ping',
}

/** Frames the gateway may send. */
export enum DashboardWsServerFrame {
  /** First frame after a successful upgrade: carries the connection id. */
  CONNECTED = 'connected',
  PONG = 'pong',
  ERROR = 'error',
}

export enum DashboardWsErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  ORIGIN_NOT_ALLOWED = 'ORIGIN_NOT_ALLOWED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_MESSAGE_TYPE = 'INVALID_MESSAGE_TYPE',
}

export const DASHBOARD_WS_PATH = '/v1/dashboard/ws';
export const DASHBOARD_WS_HEARTBEAT_INTERVAL_MS = 25_000;

// 4000-4999 is the application-defined range (RFC 6455 §7.4.2). Kept
// distinct from both chat's (44xx) and signaling's (40xx) codes so a
// developer reading a close code in devtools can tell which plane it came
// from.
export const DASHBOARD_WS_CLOSE_AUTH_FAILED = 4801;
export const DASHBOARD_WS_CLOSE_FORBIDDEN = 4803;
export const DASHBOARD_WS_CLOSE_RATE_LIMITED = 4829;
export const DASHBOARD_WS_CLOSE_TOKEN_EXPIRED = 4840;
export const DASHBOARD_WS_CLOSE_SERVER_SHUTDOWN = 4900;

/**
 * Redis key namespace, following chat.constants.ts's `RedisKeys` and
 * signaling.constants.ts's `SignalingRedisKeys` convention.
 */
export const DashboardWsRedisKeys = {
  /** Pub/sub channel, one per project; gateways subscribe on demand. Phase 5B never publishes to it — the plumbing exists so 5C+ has somewhere to publish without touching the gateway's connection handling. */
  projectChannel: (projectId: string) => `raven:dash:project:${projectId}:events`,
  revokedToken: (jti: string) => `raven:dash:token:revoked:${jti}`,
} as const;
