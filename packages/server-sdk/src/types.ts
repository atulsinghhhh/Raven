// Every shape here mirrors the real Control API response 1:1 (see
// apps/api's controllers/DTOs) — nothing here is speculative.

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type RoomStatus = 'ACTIVE' | 'CLOSED';

export interface Room {
  id: string;
  projectId: string;
  name: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LiveTrackInfo {
  sid: string;
  kind: 'audio' | 'video' | 'unknown';
  name: string;
  muted: boolean;
}

export interface LiveParticipantInfo {
  identity: string;
  joinedAt: string;
  tracks: LiveTrackInfo[];
}

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

/** Raven's own permission vocabulary — see docs/control-plane.md#rtc-tokens. */
export interface TokenPermissions {
  join?: boolean;
  subscribe?: boolean;
  publish?: boolean;
  publishAudio?: boolean;
  publishVideo?: boolean;
  publishData?: boolean;
}

export interface CreateTokenParams {
  /** The room's ID (from `rooms.create()`/`rooms.list()`) — not its display name. */
  room: string;
  /** Unique within the room. Letters, numbers, "-", "_", "." only. */
  identity: string;
  permissions?: TokenPermissions;
  /** Token lifetime in seconds (30-21600). Defaults to the API's own default — always short-lived, never permanent. */
  expiresIn?: number;
  metadata?: string;
}

export interface IssuedToken {
  id: string;
  token: string;
  livekitUrl: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: TokenPermissions;
  iceServers: IceServer[];
  telemetryUrl: string;
  expiresAt: string;
  createdAt: string;
}

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'FAILED';

export interface ConnectionSummary {
  id: string;
  publicId: string;
  projectId: string;
  roomId: string | null;
  roomName: string;
  participantId: string | null;
  participantIdentity: string;
  state: ConnectionState;
  disconnectReason: string | null;
  region: string | null;
  sdkVersion: string | null;
  platform: string | null;
  browser: string | null;
  networkType: string | null;
  iceConnectionState: string | null;
  signalingState: string | null;
  reconnectCount: number;
  startedAt: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionEventEntry {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  timestamp: string;
}

export interface ConnectionDetail extends ConnectionSummary {
  events: ConnectionEventEntry[];
  errors: ErrorSummary[];
}

export type ErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'TOKEN_ERROR'
  | 'SIGNALING_ERROR'
  | 'ICE_ERROR'
  | 'TURN_ERROR'
  | 'SFU_ERROR'
  | 'NETWORK_ERROR'
  | 'CLIENT_ERROR'
  | 'UNKNOWN_ERROR';

export interface ErrorSummary {
  id: string;
  publicId: string;
  projectId: string;
  connectionId: string | null;
  roomId: string | null;
  participantId: string | null;
  category: ErrorCategory;
  message: string;
  likelyCause: string | null;
  suggestedAction: string | null;
  sdkVersion: string | null;
  platform: string | null;
  timestamp: string;
}

export interface ErrorDetail extends ErrorSummary {
  connection: ConnectionSummary | null;
}

export type MetricsRange = '15m' | '1h' | '24h' | '7d';

export interface MetricsOverview {
  range: string;
  activeRooms: number;
  activeParticipants: number;
  connections: number;
  connectionSuccessRate: number | null;
  reconnectionRate: number | null;
  averageConnectionDurationMs: number | null;
  errors: number;
}

export type DependencyStatus = 'up' | 'down';

export interface ProjectDiagnostics {
  project: { id: string; name: string };
  api: 'up';
  authentication: 'ok';
  dependencies: {
    signaling: DependencyStatus;
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
  connections: { active: number };
}

export interface ListConnectionsParams {
  roomId?: string;
  state?: ConnectionState;
  limit?: number;
}

export interface ListErrorsParams {
  category?: ErrorCategory;
  connectionId?: string;
  limit?: number;
}
