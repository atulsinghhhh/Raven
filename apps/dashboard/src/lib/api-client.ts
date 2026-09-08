// Everything in here runs server-side and talks to the Control API. The
// browser never hits it directly and never sees the JWT. This is the only
// file that knows the API's base URL and response shapes. Don't go fetching
// it from anywhere else.
const API_BASE_URL = process.env.RAVEN_API_URL ?? 'http://localhost:4100';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  /** Optional: the dashboard may be newer than the API it's talking to. */
  emailVerified?: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  step: number;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: string;
  user: AuthenticatedUser;
  /** Where this account is in first-run onboarding. Optional: the dashboard
   *  may be newer than the API it's talking to. */
  onboarding?: OnboardingStatus;
}

export type OAuthProvider = 'github' | 'google';

export interface OAuthProviderAvailability {
  github: boolean;
  google: boolean;
}

export interface OnboardingState {
  step: number;
  completed: boolean;
  completedAt: string | null;
  useCases: string[];
  experienceLevel: string | null;
  stack: string[];
  createdFirstProject: boolean;
}

export interface UpdateOnboardingInput {
  step?: number;
  useCases?: string[];
  experienceLevel?: string;
  stack?: string[];
  createdFirstProject?: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** False for OAuth-only accounts — settings offers "set a password" instead of "change password". */
  hasPassword: boolean;
  createdAt: string;
  authAccounts: Array<{ provider: 'GITHUB' | 'GOOGLE'; email: string | null; createdAt: string }>;
  onboarding: OnboardingStatus;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type Environment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

export interface ApiKeySummary {
  id: string;
  projectId: string;
  publicId: string;
  name: string | null;
  /** Optional: the dashboard may be newer than the API it's talking to. */
  environment?: Environment;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export type ProjectRole = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER' | 'BILLING';

export interface ProjectMember {
  userId: string;
  email: string;
  name: string | null;
  role: ProjectRole;
  /** What this member's role allows. The API sends it, so the UI never keeps a second copy of the matrix. */
  capabilities: string[];
  invitedById: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  publicId: string;
  projectId: string;
  environment: Environment | null;
  actorId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  id: string;
  name: string | null;
  environment: Environment;
  publicId: string;
  key: string;
  createdAt: string;
  warning: string;
}

export interface RoomWithLiveState {
  id: string;
  projectId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** null means the room's RTC server was unreachable. Not the same as an idle room with 0 participants. */
  liveParticipantCount: number | null;
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

export interface RoomDetail extends RoomWithLiveState {
  liveParticipants: LiveParticipantInfo[] | null;
}

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IssuedRtcToken {
  id: string;
  token: string;
  endpoint: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: Record<string, boolean>;
  iceServers: IceServer[];
  telemetryUrl: string;
  expiresAt: string;
  createdAt: string;
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
  /**
   * Comes from the SDK's `Room.getConnectionStats()`, reported over
   * telemetry. Absent until at least one stats sample has arrived, and the
   * browser SDK sends one every 5s while connected.
   *
   * Never estimated, never backfilled. A connection that never sent one
   * keeps these null.
   */
  connectionQuality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown' | null;
  /** Round-trip time in ms, send direction only. WebRTC has no receiver-side RTT. */
  rttMs: number | null;
  /** Worst (max) jitter in ms across every track on this connection. */
  jitterMs: number | null;
  /** Worst (max) packet loss percentage across every track. */
  packetLossPercent: number | null;
  /** Summed send + receive bitrate across every track, in bits/sec. */
  bitrateBps: number | null;
  codec: string | null;
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
    signaling: 'up' | 'down';
    sfu: 'up' | 'down';
    turn: 'up' | 'down';
  };
  connections: { active: number };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    sfu: 'up' | 'down';
    turn: 'up' | 'down';
  };
  signaling: {
    activeConnections: number;
    activeRooms: number;
    activeParticipants: number;
  };
}

// ---------------------------------------------------------------------------
// RTC fleet
//
// Deployment-level rather than project-scoped, on purpose. An SFU node is
// shared infrastructure, so there's no project whose membership could
// authorize it.
//
// What it exposes is node identity, health and aggregate load. No project
// data at all, which is why any authenticated developer of this deployment
// can see it without learning a thing about anyone else's rooms.
// ---------------------------------------------------------------------------

export type RtcServerStatus = 'HEALTHY' | 'DRAINING' | 'UNHEALTHY';

export interface RtcServer {
  id: string;
  name: string;
  region: string;
  status: RtcServerStatus;
  /** What ICE advertises to clients. Shown for support, never used by the dashboard to connect. */
  publicHost: string;
  /** How the control plane reaches this node. Internal; not a client address. */
  internalUrl: string;
  capacity: number;
  activeRooms: number;
  activeParticipants: number;
  /**
   * Load figures a node reported on its **last heartbeat**, not live truth.
   *
   * Null wherever the node didn't report one. A node that omits CPU is not a
   * node sitting at 0% CPU, and the UI mustn't draw it as one.
   */
  cpuPercent: number | null;
  memoryPercent: number | null;
  networkInBps: number | null;
  networkOutBps: number | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface RtcFleetMetrics {
  servers: number;
  healthyServers: number;
  drainingServers: number;
  unhealthyServers: number;
  /** Rooms the fleet is actually *serving*. A room row with no assigned node is not counted. */
  activeRooms: number;
  activeParticipants: number;
  capacity: number;
}

// ---------------------------------------------------------------------------
// Live Streaming (Phase 15)
//
// Inspection only, same rule as Rooms and Chat. This dashboard never
// creates, starts, updates or ends a stream. Those are calls your own
// backend makes with @ravenkash/server or raven-sdk. The dashboard shows what
// already exists, the same way `rooms` shows rooms nobody clicked "create"
// for in here.
// ---------------------------------------------------------------------------

export type LiveStreamStatus = 'CREATED' | 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED';
export type LiveStreamVisibility = 'PUBLIC' | 'PRIVATE' | 'AUTHENTICATED';
export type LiveStreamHostRole = 'HOST' | 'CO_HOST';

export interface LiveStreamHostSummary {
  identity: string;
  role: LiveStreamHostRole;
  invitedAt: string;
}

export interface LiveStreamSummary {
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
  hosts: LiveStreamHostSummary[];
  /** null means the SFU couldn't be reached when this was read, and it's never coerced to 0. Always null from `listLiveStreams`; only `getLiveStream` polls for it. */
  viewerCount: number | null;
  peakViewerCount: number;
  conversationId: string | null;
  chatRootMessageId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Chat (Phase 12)
//
// Worth noticing what these types don't carry: message text. The dashboard
// shows activity metadata, meaning counts, timestamps and connection state,
// and never message contents (spec §50). Adding a `lastMessageText` field
// here would be the exact moment that privacy line got crossed.
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
    /** null means nothing was measured in this window. Not "zero milliseconds". */
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

/** ChatConversationSummary plus the fields only worth fetching for one conversation at a time. */
export interface ChatConversationDetail extends ChatConversationSummary {
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

export type ChatMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface ChatConversationMember {
  userId: string;
  role: ChatMemberRole;
  status: 'ACTIVE' | 'LEFT';
  joinedAt: string;
  leftAt: string | null;
}

/**
 * Message metadata, never content. The API's `select` clause is what
 * actually enforces that (spec §50). This type simply can't name a field
 * that was never in the response.
 */
export interface ChatMessageSummary {
  id: string;
  senderId: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';
  status: 'sent' | 'edited' | 'deleted';
  replyToMessageId: string | null;
  threadRootId: string | null;
  reactionCount: number;
  attachmentCount: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
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

export interface PresenceEntry {
  userId: string;
  status: 'online' | 'away' | 'offline';
}

export interface WebhookEndpointSummary {
  id: string;
  publicId: string;
  projectId: string;
  url: string;
  description: string | null;
  enabledEvents: string[];
  status: 'ACTIVE' | 'DISABLED';
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedWebhookEndpoint extends WebhookEndpointSummary {
  /** Returned exactly once, at creation. Same contract as an API key secret. */
  signingSecret: string;
  warning: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  eventId: string;
  endpointId: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
  event: { publicId: string; type: string; createdAt: string };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
}

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const payload = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(res.status, payload?.code ?? 'UNKNOWN', payload?.message ?? 'Request failed');
  }

  return payload as T;
}

export const ravenApi = {
  register: (email: string, password: string, name?: string) =>
    apiFetch<AuthResponse>('/v1/auth/register', {
      method: 'POST',
      body: { email, password, ...(name ? { name } : {}) },
    }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>('/v1/auth/login', { method: 'POST', body: { email, password } }),

  logout: (token: string) => apiFetch<void>('/v1/auth/logout', { method: 'POST', token }),

  // Email verification and password reset. Careful with the two senses of
  // "token" in here: `token` in RequestOptions is the session JWT, while the
  // values below are the single-use tokens out of an email link. Those are
  // never a session credential, and they travel in the body, never a
  // header.
  verifyEmail: (verificationToken: string) =>
    apiFetch<{ email: string; verifiedAt: string }>('/v1/auth/verify-email', {
      method: 'POST',
      body: { token: verificationToken },
    }),

  resendVerificationEmail: (token: string) =>
    apiFetch<{ status: 'sent' | 'already_verified' | 'suppressed'; message: string }>('/v1/auth/verify-email/resend', {
      method: 'POST',
      token,
    }),

  requestPasswordReset: (email: string) =>
    apiFetch<{ message: string }>('/v1/auth/password-reset', { method: 'POST', body: { email } }),

  resetPassword: (resetToken: string, password: string) =>
    apiFetch<{ message: string }>('/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: resetToken, password },
    }),

  // OAuth sign-in. `start` and `exchange` are only ever called by our own
  // server-side route handlers (app/api/auth/oauth) — the browser sees the
  // provider's authorize page and our redirects, never these calls, and the
  // client secret never leaves the Control API.
  oauthProviders: () => apiFetch<OAuthProviderAvailability>('/v1/auth/oauth/providers'),

  oauthStart: (provider: OAuthProvider) =>
    apiFetch<{ authorizeUrl: string; state: string }>(`/v1/auth/oauth/${provider}/start`, { method: 'POST' }),

  oauthExchange: (provider: OAuthProvider, code: string, state: string) =>
    apiFetch<AuthResponse>(`/v1/auth/oauth/${provider}/exchange`, { method: 'POST', body: { code, state } }),

  getMe: (token: string) => apiFetch<UserProfile>('/v1/users/me', { token }),

  updateMe: (token: string, input: { name?: string }) =>
    apiFetch<UserProfile>('/v1/users/me', { method: 'PATCH', token, body: input }),

  getOnboarding: (token: string) => apiFetch<OnboardingState>('/v1/onboarding', { token }),

  updateOnboarding: (token: string, input: UpdateOnboardingInput) =>
    apiFetch<OnboardingState>('/v1/onboarding', { method: 'PATCH', token, body: input }),

  completeOnboarding: (token: string) =>
    apiFetch<OnboardingState>('/v1/onboarding/complete', { method: 'POST', token }),

  listProjects: (token: string) => apiFetch<Project[]>('/v1/projects', { token }),

  getProject: (token: string, projectId: string) => apiFetch<Project>(`/v1/projects/${projectId}`, { token }),

  createProject: (token: string, input: { name: string; description?: string }) =>
    apiFetch<Project>('/v1/projects', { method: 'POST', token, body: input }),

  updateProject: (token: string, projectId: string, input: { name?: string; description?: string }) =>
    apiFetch<Project>(`/v1/projects/${projectId}`, { method: 'PATCH', token, body: input }),

  archiveProject: (token: string, projectId: string) =>
    apiFetch<void>(`/v1/projects/${projectId}`, { method: 'DELETE', token }),

  listApiKeys: (token: string, projectId: string) =>
    apiFetch<ApiKeySummary[]>(`/v1/projects/${projectId}/api-keys`, { token }),

  createApiKey: (token: string, projectId: string, input: { name?: string; environment?: Environment }) =>
    apiFetch<CreatedApiKey>(`/v1/projects/${projectId}/api-keys`, { method: 'POST', token, body: input }),

  revokeApiKey: (token: string, projectId: string, keyId: string) =>
    apiFetch<void>(`/v1/projects/${projectId}/api-keys/${keyId}`, { method: 'DELETE', token }),

  listMembers: (token: string, projectId: string) =>
    apiFetch<ProjectMember[]>(`/v1/projects/${projectId}/members`, { token }),

  addMember: (token: string, projectId: string, input: { email: string; role?: ProjectRole }) =>
    apiFetch<ProjectMember>(`/v1/projects/${projectId}/members`, { method: 'POST', token, body: input }),

  updateMemberRole: (token: string, projectId: string, userId: string, role: ProjectRole) =>
    apiFetch<ProjectMember>(`/v1/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  removeMember: (token: string, projectId: string, userId: string) =>
    apiFetch<void>(`/v1/projects/${projectId}/members/${userId}`, { method: 'DELETE', token }),

  listAuditLogs: (
    token: string,
    projectId: string,
    opts: { action?: string; actorId?: string; resourceId?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.action) params.set('action', opts.action);
    if (opts.actorId) params.set('actorId', opts.actorId);
    if (opts.resourceId) params.set('resourceId', opts.resourceId);
    // Capped at 200 server-side (QueryAuditLogsDto).
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<AuditLogEntry[]>(`/v1/projects/${projectId}/audit-logs${query}`, { token });
  },

  listRooms: (token: string, projectId: string) =>
    apiFetch<RoomWithLiveState[]>(`/v1/projects/${projectId}/rooms`, { token }),

  getRoom: (token: string, projectId: string, roomId: string) =>
    apiFetch<RoomDetail>(`/v1/projects/${projectId}/rooms/${roomId}`, { token }),

  createTestToken: (token: string, projectId: string, roomId: string, participantIdentity?: string) =>
    apiFetch<IssuedRtcToken>(`/v1/projects/${projectId}/rooms/${roomId}/test-token`, {
      method: 'POST',
      token,
      body: { participantIdentity },
    }),

  listRtcServers: (token: string, region?: string) =>
    apiFetch<RtcServer[]>(`/v1/rtc/servers${region ? `?region=${encodeURIComponent(region)}` : ''}`, { token }),

  getRtcFleetMetrics: (token: string) => apiFetch<RtcFleetMetrics>('/v1/rtc/servers/metrics', { token }),

  getRtcServer: (token: string, name: string) =>
    apiFetch<RtcServer>(`/v1/rtc/servers/${encodeURIComponent(name)}`, { token }),

  /**
   * Takes a node out of the allocation pool without stopping it. Its
   * existing rooms carry on; spec §26 is explicit that draining mustn't
   * kill live calls.
   */
  drainRtcServer: (token: string, name: string) =>
    apiFetch<RtcServer>(`/v1/rtc/servers/${encodeURIComponent(name)}/drain`, { method: 'POST', token }),

  undrainRtcServer: (token: string, name: string) =>
    apiFetch<RtcServer>(`/v1/rtc/servers/${encodeURIComponent(name)}/undrain`, { method: 'POST', token }),

  getHealth: () => apiFetch<HealthResponse>('/health'),

  listConnections: (
    token: string,
    projectId: string,
    opts: { roomId?: string; state?: ConnectionLifecycleState; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.roomId) params.set('roomId', opts.roomId);
    if (opts.state) params.set('state', opts.state);
    // The API caps this at 200 and defaults to 50 (QueryConnectionsDto).
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<ConnectionSummary[]>(`/v1/projects/${projectId}/connections${query}`, { token });
  },

  getConnection: (token: string, projectId: string, connectionId: string) =>
    apiFetch<ConnectionDetail>(`/v1/projects/${projectId}/connections/${connectionId}`, { token }),

  listErrors: (
    token: string,
    projectId: string,
    opts: { category?: ErrorCategory; connectionId?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.category) params.set('category', opts.category);
    if (opts.connectionId) params.set('connectionId', opts.connectionId);
    // Capped at 200 server-side (QueryErrorsDto).
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<ErrorSummary[]>(`/v1/projects/${projectId}/errors${query}`, { token });
  },

  getError: (token: string, projectId: string, errorId: string) =>
    apiFetch<ErrorDetail>(`/v1/projects/${projectId}/errors/${errorId}`, { token }),

  getMetrics: (token: string, projectId: string, range?: string) =>
    apiFetch<ObservabilityOverview>(`/v1/projects/${projectId}/metrics${range ? `?range=${range}` : ''}`, { token }),

  getDiagnostics: (token: string, projectId: string) =>
    apiFetch<ProjectDiagnostics>(`/v1/projects/${projectId}/diagnostics`, { token }),

  getChatOverview: (token: string, projectId: string, range?: string) =>
    apiFetch<ChatOverview>(`/v1/projects/${projectId}/chat/overview${range ? `?range=${range}` : ''}`, { token }),

  listChatConversations: (token: string, projectId: string) =>
    apiFetch<ChatConversationSummary[]>(`/v1/projects/${projectId}/chat/conversations`, { token }),

  getChatConversation: (token: string, projectId: string, conversationId: string) =>
    apiFetch<ChatConversationDetail>(`/v1/projects/${projectId}/chat/conversations/${conversationId}`, { token }),

  listChatConversationMembers: (token: string, projectId: string, conversationId: string) =>
    apiFetch<ChatConversationMember[]>(`/v1/projects/${projectId}/chat/conversations/${conversationId}/members`, {
      token,
    }),

  listChatConversationMessages: (
    token: string,
    projectId: string,
    conversationId: string,
    opts: { senderId?: string; before?: string; after?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.senderId) params.set('senderId', opts.senderId);
    if (opts.before) params.set('before', opts.before);
    if (opts.after) params.set('after', opts.after);
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<ChatMessageSummary[]>(
      `/v1/projects/${projectId}/chat/conversations/${conversationId}/messages${query}`,
      { token },
    );
  },

  listChatConnections: (
    token: string,
    projectId: string,
    opts: { state?: ConnectionLifecycleState; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.state) params.set('state', opts.state);
    // Capped at 200 server-side, same as the RTC connections endpoint.
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<ChatConnectionSummary[]>(`/v1/projects/${projectId}/chat/connections${query}`, { token });
  },

  getChatPresence: (token: string, projectId: string, conversationId: string) =>
    apiFetch<PresenceEntry[]>(`/v1/projects/${projectId}/chat/conversations/${conversationId}/presence`, { token }),

  listWebhooks: (token: string, projectId: string) =>
    apiFetch<WebhookEndpointSummary[]>(`/v1/projects/${projectId}/webhooks`, { token }),

  createWebhook: (token: string, projectId: string, input: { url: string; description?: string; events?: string[] }) =>
    apiFetch<CreatedWebhookEndpoint>(`/v1/projects/${projectId}/webhooks`, { method: 'POST', token, body: input }),

  updateWebhook: (
    token: string,
    projectId: string,
    webhookId: string,
    input: { url?: string; events?: string[]; status?: 'ACTIVE' | 'DISABLED' },
  ) =>
    apiFetch<WebhookEndpointSummary>(`/v1/projects/${projectId}/webhooks/${webhookId}`, {
      method: 'PATCH',
      token,
      body: input,
    }),

  deleteWebhook: (token: string, projectId: string, webhookId: string) =>
    apiFetch<void>(`/v1/projects/${projectId}/webhooks/${webhookId}`, { method: 'DELETE', token }),

  listWebhookDeliveries: (token: string, projectId: string, webhookId: string) =>
    apiFetch<WebhookDeliveryRecord[]>(`/v1/projects/${projectId}/webhooks/${webhookId}/deliveries`, { token }),

  listLiveStreams: (token: string, projectId: string, status?: LiveStreamStatus) =>
    apiFetch<LiveStreamSummary[]>(`/v1/projects/${projectId}/live-streams${status ? `?status=${status}` : ''}`, {
      token,
    }),

  /** Includes the stream's live viewer count. `listLiveStreams` doesn't, to avoid an SFU round trip per row. */
  getLiveStream: (token: string, projectId: string, streamId: string) =>
    apiFetch<LiveStreamSummary>(`/v1/projects/${projectId}/live-streams/${streamId}`, { token }),
};
