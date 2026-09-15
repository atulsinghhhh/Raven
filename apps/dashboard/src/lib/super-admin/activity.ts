// Typed client for the Global Activity Explorer (§8). Mirrors the shape of
// `ActivityEvent` in apps/api's Prisma schema, and goes through the same
// `superAdminFetch` BFF helper every other super-admin domain client uses —
// the API re-checks the platform role on every request regardless of what
// this file assumes.
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type ActivityActorType = 'USER' | 'ADMIN' | 'SYSTEM' | 'API_KEY';

/**
 * Every value the enum defines, grouped by product, purely for building
 * the filter UI. Mirrors `ACTIVITY_EVENT_GROUPS` in
 * apps/api/src/modules/super-admin/activity-events.constants.ts — kept as
 * a plain const here since a Nest-side file can't be imported into the
 * dashboard. Update both places together if the enum changes.
 */
export const ACTIVITY_EVENT_GROUPS: Record<string, string[]> = {
  Authentication: [
    'USER_SIGNED_UP',
    'USER_LOGIN',
    'USER_LOGOUT',
    'LOGIN_FAILED',
    'PASSWORD_CHANGED',
    'OAUTH_CONNECTED',
  ],
  Projects: ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED', 'PROJECT_MEMBER_ADDED', 'PROJECT_MEMBER_REMOVED'],
  API: ['API_KEY_CREATED', 'API_KEY_REVOKED', 'API_REQUEST_FAILED'],
  RTC: [
    'RTC_ROOM_CREATED',
    'RTC_ROOM_ENDED',
    'RTC_PARTICIPANT_JOINED',
    'RTC_PARTICIPANT_LEFT',
    'RTC_CONNECTION_FAILED',
    'RTC_RECONNECT',
    'RTC_TOKEN_CREATED',
  ],
  Chat: ['CHAT_CONVERSATION_CREATED', 'CHAT_MEMBER_ADDED', 'CHAT_MESSAGE_SENT', 'CHAT_MESSAGE_FAILED'],
  'Live Streaming': [
    'LIVE_STREAM_CREATED',
    'LIVE_STREAM_STARTED',
    'LIVE_STREAM_ENDED',
    'LIVE_STREAM_HOST_JOINED',
    'LIVE_STREAM_VIEWER_JOINED',
    'LIVE_STREAM_FAILED',
  ],
  Security: ['SUSPICIOUS_ACTIVITY', 'RATE_LIMIT_TRIGGERED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_UNSUSPENDED'],
  Admin: [
    'ADMIN_LOGIN',
    'ADMIN_USER_VIEWED',
    'ADMIN_PROJECT_VIEWED',
    'ADMIN_ACCOUNT_SUSPENDED',
    'ADMIN_ACCOUNT_UNSUSPENDED',
    'ADMIN_LIMIT_CHANGED',
    'ADMIN_ACTION',
  ],
};

/** Every event type the enum defines, in declaration order — flattened from the groups above. */
export const ALL_ACTIVITY_EVENT_TYPES: string[] = Object.values(ACTIVITY_EVENT_GROUPS).flat();

export interface ActivityEvent {
  id: string;
  publicId: string;
  eventType: string;
  actorType: ActivityActorType;
  actorId: string | null;
  actorEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  projectId: string | null;
  developerId: string | null;
  success: boolean;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityEventPage {
  items: ActivityEvent[];
  total: number;
}

export interface ActivityFilters {
  developerId?: string;
  projectId?: string;
  eventType?: string;
  actorType?: ActivityActorType;
  success?: boolean;
  ipAddress?: string;
  requestId?: string;
  resourceId?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** `GET /v1/super-admin/activity` — the Global Activity Explorer's one data source. */
export function listActivity(token: string, filters: ActivityFilters = {}): Promise<ActivityEventPage> {
  // `ActivityFilters` has no index signature of its own (each field is
  // named and typed individually for callers' benefit), but every value on
  // it is already a member of `buildQuery`'s accepted union — this cast
  // just satisfies the structural check, it doesn't widen what's allowed.
  return superAdminFetch<ActivityEventPage>(
    `/v1/super-admin/activity${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}
