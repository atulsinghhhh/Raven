// Typed client for the Live Streaming section of the Super Admin Portal
// (spec §12) — platform-wide, across every project. Mirrors the shape of
// `apps/api/src/modules/super-admin/live/live.service.ts`'s response types
// and goes through the same `superAdminFetch` BFF helper every other
// super-admin domain client uses — the API re-checks the platform role on
// every request regardless of what this file assumes.
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type LiveStreamStatus = 'CREATED' | 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED';
export type LiveStreamVisibility = 'PUBLIC' | 'PRIVATE' | 'AUTHENTICATED';
export type LiveStreamDeliveryMode = 'RTC_ONLY' | 'BROADCAST';
export type LiveStreamHostRole = 'HOST' | 'CO_HOST';
export type LiveStreamEgressStatus = 'NOT_STARTED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';

export interface LiveOverview {
  generatedAt: string;
  activeStreams: number;
  streamsToday: number;
  totalStreams: number;
  totalViewersToday: number;
  peakViewersToday: number;
  peakViewersAllTime: number;
  sumStreamDurationMsToday: number;
  avgStreamDurationMsToday: number | null;
  failedStreams: number;
}

export interface LiveStreamListItem {
  id: string;
  projectId: string;
  projectName: string;
  ownerEmail: string;
  environment: string;
  title: string;
  status: LiveStreamStatus;
  deliveryMode: LiveStreamDeliveryMode;
  visibility: LiveStreamVisibility;
  hostIdentity: string | null;
  peakViewerCount: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface LiveStreamPage {
  items: LiveStreamListItem[];
  total: number;
}

export interface LiveStreamHostDetail {
  id: string;
  identity: string;
  role: LiveStreamHostRole;
  invitedAt: string;
  removedAt: string | null;
}

export interface LiveStreamEgressDetail {
  status: LiveStreamEgressStatus;
  workerId: string | null;
  playbackUrl: string | null;
  hlsReadyAt: string | null;
  lastSegmentAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface LiveStreamDetail extends LiveStreamListItem {
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  scheduledAt: string | null;
  updatedAt: string;
  conversationId: string | null;
  room: {
    id: string;
    name: string;
    status: string;
    rtcServerId: string | null;
    region: string | null;
  } | null;
  hosts: LiveStreamHostDetail[];
  egress: LiveStreamEgressDetail | null;
}

export interface LiveStreamFilters {
  status?: LiveStreamStatus;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** `GET /v1/super-admin/live/overview` — the section's StatCard grid. */
export function getLiveOverview(token: string): Promise<LiveOverview> {
  return superAdminFetch<LiveOverview>('/v1/super-admin/live/overview', { token });
}

/** `GET /v1/super-admin/live/streams` — every stream, every project, paginated. */
export function listLiveStreams(token: string, filters: LiveStreamFilters = {}): Promise<LiveStreamPage> {
  // `buildQuery`'s param type has a plain string index signature; a named
  // interface with literal-union members (status here) needs an explicit
  // cast to satisfy it structurally — the values themselves are always
  // plain strings/numbers/undefined by the time they reach `buildQuery`.
  return superAdminFetch<LiveStreamPage>(
    `/v1/super-admin/live/streams${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}

/** `GET /v1/super-admin/live/streams/:id` — one stream in full detail. */
export function getLiveStream(token: string, id: string): Promise<LiveStreamDetail> {
  return superAdminFetch<LiveStreamDetail>(`/v1/super-admin/live/streams/${encodeURIComponent(id)}`, { token });
}
