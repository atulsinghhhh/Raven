// Everything here runs server-side and talks to the Control API — the
// browser never hits it directly, never sees the JWT. This is the only file
// that knows the API's base URL and response shapes; don't fetch it elsewhere.
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
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: string;
  user: AuthenticatedUser;
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

export interface ApiKeySummary {
  id: string;
  projectId: string;
  publicId: string;
  name: string | null;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string | null;
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
  /** null = LiveKit unreachable, not the same as an idle room with 0 participants. */
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
  livekitUrl: string;
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
    livekit: 'up' | 'down';
    turn: 'up' | 'down';
  };
  signaling: {
    activeConnections: number;
    activeRooms: number;
    activeParticipants: number;
  };
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
  register: (email: string, password: string) =>
    apiFetch<AuthResponse>('/v1/auth/register', { method: 'POST', body: { email, password } }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>('/v1/auth/login', { method: 'POST', body: { email, password } }),

  logout: (token: string) => apiFetch<void>('/v1/auth/logout', { method: 'POST', token }),

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

  createApiKey: (token: string, projectId: string, input: { name?: string }) =>
    apiFetch<CreatedApiKey>(`/v1/projects/${projectId}/api-keys`, { method: 'POST', token, body: input }),

  revokeApiKey: (token: string, projectId: string, keyId: string) =>
    apiFetch<void>(`/v1/projects/${projectId}/api-keys/${keyId}`, { method: 'DELETE', token }),

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
};
