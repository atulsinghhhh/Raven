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

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';

export interface ApiKeySummary {
  id: string;
  projectId: string;
  publicId: string;
  name: string | null;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string | null;
  publicId: string;
  /** Only time the raw secret is visible — not persisted, not logged, never shown again after this. */
  key: string;
  createdAt: string;
  warning: string;
}

export type RoomStatus = 'ACTIVE' | 'CLOSED';

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

export interface RoomWithLiveState {
  id: string;
  projectId: string;
  name: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
  /** null = couldn't reach LiveKit, not the same thing as a genuinely idle room. */
  liveParticipantCount: number | null;
}

export interface RoomDetailWithLiveState extends RoomWithLiveState {
  liveParticipants: LiveParticipantInfo[] | null;
}

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface RtcTokenPermissions {
  join: boolean;
  subscribe: boolean;
  publish: boolean;
  publishAudio: boolean;
  publishVideo: boolean;
  publishData: boolean;
}

export interface IssuedRtcToken {
  id: string;
  token: string;
  livekitUrl: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: RtcTokenPermissions;
  iceServers: IceServer[];
  telemetryUrl: string;
  expiresAt: string;
  createdAt: string;
}

export type DependencyStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    livekit: DependencyStatus;
    turn: DependencyStatus;
  };
  signaling: {
    activeConnections: number;
    activeRooms: number;
    activeParticipants: number;
  };
}

export type ConnectionLifecycleState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'FAILED';

export interface ConnectionSummary {
  id: string;
  publicId: string;
  projectId: string;
  roomId: string | null;
  roomName: string;
  participantId: string | null;
  participantIdentity: string;
  state: ConnectionLifecycleState;
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

export interface ObservabilityOverview {
  range: string;
  activeRooms: number;
  activeParticipants: number;
  connections: number;
  connectionSuccessRate: number | null;
  reconnectionRate: number | null;
  averageConnectionDurationMs: number | null;
  errors: number;
}

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

// ---------------------------------------------------------------------------
// Chat (Phase 12)
//
// Note what these carry and what they don't: activity metadata, never
// message text. The CLI reads the same dashboard-facing endpoints the web
// dashboard does, and those deliberately don't return message contents
// (docs/security/chat.md#privacy). A `raven chat` command that printed
// customers' messages to a terminal would be the wrong tool entirely.
// ---------------------------------------------------------------------------

export interface ChatOverview {
  range: string;
  conversations: number;
  messagesStored: number;
  activeConnections: number;
  messagesSent: number;
  messagesFailed: number;
  messagesFannedOut: number;
  connectionsOpened: number;
  connectionsFailed: number;
  rateLimited: number;
  messagesPerSecond: number;
  latency: {
    /** null = nothing measured in this window, not "zero milliseconds". */
    persistMs: number | null;
    fanoutMs: number | null;
    endToEndMs: number | null;
  };
  gateway: {
    gatewayId: string;
    activeConnections: number;
    subscribedRooms: number;
    subscribedChannels: number;
  };
}

export interface ChatConversationSummary {
  id: string;
  name: string;
  type: 'ROOM' | 'CHANNEL' | 'DIRECT';
  status: 'ACTIVE' | 'ARCHIVED';
  roomId: string | null;
  retentionDays: number | null;
  messageCount: number;
  memberCount: number;
  lastMessageAt: string | null;
  lastMessageSenderId: string | null;
  createdAt: string;
}

export interface ChatConnectionSummary {
  id: string;
  publicId: string;
  projectId: string;
  conversationId: string | null;
  userId: string;
  gatewayId: string;
  state: ConnectionLifecycleState;
  disconnectReason: string | null;
  sdkVersion: string | null;
  platform: string | null;
  messagesSent: number;
  connectedAt: string | null;
  disconnectedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatPresenceEntry {
  userId: string;
  status: 'online' | 'away' | 'offline';
}
