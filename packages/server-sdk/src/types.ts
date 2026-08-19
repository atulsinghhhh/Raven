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
  /** Where the client SDK connects to run the call. Forward this to `createRTCClient({ endpoint })` as-is. */
  endpoint: string;
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

// ---------------------------------------------------------------------------
// Chat (Phase 12)
// ---------------------------------------------------------------------------

export type ChatScope = 'chat:read' | 'chat:send' | 'chat:moderate' | 'chat:manage';
export type ChatMemberRole = 'MEMBER' | 'MODERATOR' | 'ADMIN';
export type ChatConversationType = 'ROOM' | 'CHANNEL' | 'DIRECT';
export type ChatMessageType = 'text' | 'system' | 'event' | 'attachment';

export interface CreateChatTokenParams {
  /** Your own user identity. Everything this token sends is attributed to it. */
  userId: string;
  /** Conversations the token may touch. Omit for every conversation the user belongs to. */
  conversations?: string[];
  /** Narrows the token below the user's role. Cannot grant anything the role lacks. */
  scopes?: ChatScope[];
  /** Lifetime in seconds. There is no non-expiring chat token. */
  expiresIn?: number;
}

export interface IssuedChatToken {
  /** Hand this to the browser. Never send the project API key instead. */
  token: string;
  tokenId: string;
  userId: string;
  projectId: string;
  scopes: ChatScope[];
  conversations: string[];
  /** Pass to `createChatClient({ chatUrl })` — the SDK never hardcodes a host. */
  chatUrl: string;
  apiUrl: string;
  expiresAt: string;
}

export interface CreateConversationParams {
  name: string;
  type?: ChatConversationType;
  /** Attach to an existing RTC room, giving that call a chat panel. */
  roomId?: string;
  retentionDays?: number;
  members?: Array<{ userId: string; role?: ChatMemberRole }>;
  metadata?: Record<string, unknown>;
}

export interface ChatConversation {
  id: string;
  publicId: string;
  projectId: string;
  roomId: string | null;
  name: string;
  type: ChatConversationType;
  status: 'ACTIVE' | 'ARCHIVED';
  retentionDays: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMember {
  id: string;
  conversationId: string;
  projectId: string;
  userId: string;
  role: ChatMemberRole;
  status: 'ACTIVE' | 'LEFT';
  joinedAt: string;
  leftAt: string | null;
}

export interface SendChatMessageParams {
  text?: string;
  /** Required — a server-side send names the user it acts for. */
  senderId: string;
  type?: ChatMessageType;
  replyTo?: string;
  /** Idempotency key. Retrying with the same key returns the original message. */
  clientMessageId?: string;
  attachmentId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  text: string | null;
  replyTo: string | null;
  threadRootId: string | null;
  clientMessageId: string | null;
  metadata: Record<string, unknown> | null;
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ListChatMessagesParams {
  limit?: number;
  /** Opaque cursor from a previous page's `nextCursor`. Cursor-based, never offset. */
  before?: string;
  after?: string;
  senderId?: string;
  includeDeleted?: boolean;
}

export interface ChatMessagePage {
  data: ChatMessage[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Live Streaming (Phase 14) — reuses Rooms + RTC Tokens + Chat under the
// hood; a stream is never a third real-time system alongside them.
// ---------------------------------------------------------------------------

export type LiveStreamStatus = 'CREATED' | 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED';
export type LiveStreamVisibility = 'PUBLIC' | 'PRIVATE' | 'AUTHENTICATED';
export type LiveStreamHostRole = 'HOST' | 'CO_HOST';

export interface LiveStreamHostView {
  identity: string;
  role: LiveStreamHostRole;
  invitedAt: string;
}

export interface LiveStream {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  visibility: LiveStreamVisibility;
  metadata: Record<string, unknown> | null;
  status: LiveStreamStatus;
  hosts: LiveStreamHostView[];
  /** Live participants who are not registered hosts. `null` means the SFU could not be reached — distinct from a genuinely empty 0. */
  viewerCount: number | null;
  peakViewerCount: number;
  conversationId: string | null;
  /** The chat message viewer reactions attach to. */
  chatRootMessageId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLiveStreamParams {
  title: string;
  /** Registered as this stream's HOST — the only identity a stream is created with. */
  hostIdentity: string;
  description?: string;
  /** A URL you host — Raven does not accept or store thumbnail uploads. */
  thumbnailUrl?: string;
  category?: string;
  tags?: string[];
  language?: string;
  visibility?: LiveStreamVisibility;
  metadata?: Record<string, unknown>;
  /** ISO 8601. Raven does not auto-transition status at this time — call `start()` yourself. */
  scheduledAt?: string;
}

/** Everything about a stream you might change before or during it — never its status; use `start()`/`end()` for that. */
export interface UpdateLiveStreamParams {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  category?: string;
  tags?: string[];
  language?: string;
  visibility?: LiveStreamVisibility;
  metadata?: Record<string, unknown>;
}

export interface ListLiveStreamsParams {
  status?: LiveStreamStatus;
}

export interface AddHostParams {
  identity: string;
  /** HOST and CO_HOST get identical RTC/chat grants — the difference is bookkeeping, not permissions. Defaults to CO_HOST. */
  role?: LiveStreamHostRole;
}

export interface IssuedStreamCredential {
  identity: string;
  role: LiveStreamHostRole | 'VIEWER';
  rtc: IssuedToken;
  chat?: IssuedChatToken;
}
