// Typed client for the platform-wide RTC operations console (spec §10).
// Mirrors apps/api/src/modules/super-admin/rtc/rtc.service.ts's response
// shapes exactly — every field here comes from a real Prisma query on the
// API side, nothing is invented client-side.
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type RoomStatus = 'ACTIVE' | 'CLOSED';
export type ParticipantStatus = 'PENDING' | 'JOINED' | 'LEFT';
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'FAILED';
export type RtcServerStatus = 'HEALTHY' | 'DRAINING' | 'UNHEALTHY';

export interface RtcSfuNode {
  id: string;
  name: string;
  region: string;
  status: RtcServerStatus;
  activeRooms: number;
  activeParticipants: number;
  capacity: number;
  cpuPercent: number | null;
  memoryPercent: number | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  registeredAt: string;
}

export interface RtcOverview {
  range: string;
  activeRooms: number;
  activeParticipants: number;
  concurrentParticipants: number;
  roomsCreatedToday: number;
  roomsEndedToday: number;
  rtcMinutesToday: number;
  rtcMinutesPeriod: number;
  connectionFailures: number;
  reconnections: number;
  reconnectRate: number | null;
  averageSessionDurationMs: number | null;
  sfu: {
    totalNodes: number;
    healthyNodes: number;
    drainingNodes: number;
    unhealthyNodes: number;
    nodes: RtcSfuNode[];
  };
}

export interface RtcServerRef {
  id: string;
  name: string;
  region: string;
  status: RtcServerStatus;
}

export interface RtcRoomListItem {
  id: string;
  name: string;
  status: RoomStatus;
  environment: string;
  projectId: string;
  projectName: string;
  developerId: string;
  developerEmail: string;
  participantCount: number;
  rtcServer: RtcServerRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface RtcRoomListPage {
  items: RtcRoomListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RtcRoomParticipantSummary {
  id: string;
  identity: string;
  status: ParticipantStatus;
  joinedAt: string | null;
  leftAt: string | null;
  durationMs: number | null;
  reconnectCount: number;
  connectionState: ConnectionState | null;
  connectionQuality: string | null;
}

export interface RtcRoomDetail {
  id: string;
  name: string;
  status: RoomStatus;
  environment: string;
  projectId: string;
  projectName: string;
  developerId: string;
  developerEmail: string;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  participantCount: number;
  peakParticipants: number;
  connectionFailures: number;
  rtcServer: RtcServerRef | null;
  participants: RtcRoomParticipantSummary[];
}

export interface RtcParticipantConnection {
  id: string;
  state: ConnectionState;
  startedAt: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  durationMs: number | null;
  reconnectCount: number;
  disconnectReason: string | null;
  region: string | null;
  connectionQuality: string | null;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
}

export interface RtcParticipantToken {
  id: string;
  permissions: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

export interface RtcParticipantDetail {
  id: string;
  identity: string;
  status: ParticipantStatus;
  room: {
    id: string;
    name: string;
    status: RoomStatus;
    projectId: string;
    projectName: string;
    developerId: string;
    developerEmail: string;
  };
  joinedAt: string | null;
  leftAt: string | null;
  durationMs: number | null;
  reconnectCount: number;
  connectionState: ConnectionState | null;
  connectionQuality: string | null;
  networkQuality: {
    rttMs: number | null;
    jitterMs: number | null;
    packetLossPercent: number | null;
    bitrateBps: number | null;
  };
  rtcTokens: RtcParticipantToken[];
  connections: RtcParticipantConnection[];
}

// A type alias, not an interface: `buildQuery`'s `Record<string, ...>`
// parameter requires an explicit index signature to accept an interface
// (declaration merging makes that unsafe in general), but a type alias's
// structural shape satisfies it directly.
export type RtcRoomFilters = {
  status?: RoomStatus;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

/** `GET /v1/super-admin/rtc/overview` — the RTC console's headline stats and SFU fleet health. */
export function getRtcOverview(token: string, range?: string): Promise<RtcOverview> {
  return superAdminFetch<RtcOverview>(`/v1/super-admin/rtc/overview${buildQuery({ range })}`, { token });
}

/** `GET /v1/super-admin/rtc/rooms` — paginated rooms across every project on the platform. */
export function listRtcRooms(token: string, filters: RtcRoomFilters = {}): Promise<RtcRoomListPage> {
  return superAdminFetch<RtcRoomListPage>(`/v1/super-admin/rtc/rooms${buildQuery(filters)}`, { token });
}

/** `GET /v1/super-admin/rtc/rooms/:id` — one room, its project/developer, SFU assignment, and its participants. */
export function getRtcRoom(token: string, roomId: string): Promise<RtcRoomDetail> {
  return superAdminFetch<RtcRoomDetail>(`/v1/super-admin/rtc/rooms/${roomId}`, { token });
}

/** `GET /v1/super-admin/rtc/participants/:id` — one participant, its connection history and RTC tokens. */
export function getRtcParticipant(token: string, participantId: string): Promise<RtcParticipantDetail> {
  return superAdminFetch<RtcParticipantDetail>(`/v1/super-admin/rtc/participants/${participantId}`, { token });
}
