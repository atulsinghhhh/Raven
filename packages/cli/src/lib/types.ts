export interface AuthenticatedUserProfile {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: string;
  user: AuthenticatedUserProfile;
}

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
  /** The only time the raw secret is ever available. Never persisted, never logged, never printed a second time. */
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
  /** null means LiveKit could not be reached — distinct from a genuinely idle 0. */
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
