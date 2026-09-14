// Typed client for `/v1/super-admin/developers/*`. Mirrors the backend's
// response shapes field-for-field (apps/api/src/modules/super-admin/developers/developers.service.ts)
// so a shape change on one side is a visible type error on the other.
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type DeveloperAccountStatus = 'ACTIVE' | 'SUSPENDED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DeveloperSortField = 'name' | 'email' | 'createdAt' | 'status';
export type SortDir = 'asc' | 'desc';

export interface DeveloperListItem {
  id: string;
  email: string;
  name: string | null;
  status: DeveloperAccountStatus;
  createdAt: string;
  /** Latest `ActivityEvent.createdAt` for this developer, or `null` if none has ever been recorded. */
  lastActiveAt: string | null;
  /** Count of `ProjectMember` rows — every project this developer owns or belongs to. */
  projectsCount: number;
  rtcMinutesThisMonth: number;
  chatMessagesThisMonth: number;
  liveMinutesThisMonth: number;
  /** Count of this developer's `ActivityEvent` rows this month — the nearest real proxy to
   * "API requests" available without a per-request log (see backend service doc comment). */
  apiEventsThisMonth: number;
  riskLevel: RiskLevel;
  authProviders: string[];
}

export interface DeveloperListPage {
  items: DeveloperListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListDevelopersParams {
  search?: string;
  status?: DeveloperAccountStatus;
  from?: string;
  to?: string;
  sortBy?: DeveloperSortField;
  sortDir?: SortDir;
  limit?: number;
  offset?: number;
}

export interface ActivityEventSummary {
  id: string;
  eventType: string;
  actorType: string;
  actorEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  success: boolean;
  createdAt: string;
  metadata: unknown;
}

export interface DeveloperProjectRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  role: string;
  isOwner: boolean;
  rtcMinutes: number;
  liveMinutes: number;
  chatMessages: number;
  apiEvents: number;
}

export interface DeveloperPlanAllowance {
  product: string;
  source: string;
  includedMinutes: number | null;
  consumedMinutes: number;
  includedCount: number | null;
  consumedCount: number;
  exhaustedAt: string | null;
}

export interface DeveloperErrorSummary {
  id: string;
  category: string;
  message: string;
  timestamp: string;
}

export interface DeveloperDetail {
  id: string;
  email: string;
  name: string | null;
  status: DeveloperAccountStatus;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  platformRole: string | null;
  authProviders: string[];
  lastActiveAt: string | null;
  riskLevel: RiskLevel;
  plan: DeveloperPlanAllowance[];
  usage: {
    rtcMinutesThisMonth: number;
    liveMinutesThisMonth: number;
    chatMessagesThisMonth: number;
    apiEventsThisMonth: number;
  };
  overview: {
    recentProjects: DeveloperProjectRow[];
    recentActivity: ActivityEventSummary[];
    recentErrors: DeveloperErrorSummary[];
    recentSecurityEvents: ActivityEventSummary[];
  };
  projects: DeveloperProjectRow[];
  activity: ActivityEventSummary[];
  security: ActivityEventSummary[];
}

export interface SuspendResult {
  id: string;
  status: DeveloperAccountStatus;
  suspendedAt?: string;
  suspendedReason?: string;
}

export function listDevelopers(token: string, params: ListDevelopersParams = {}): Promise<DeveloperListPage> {
  // `ListDevelopersParams` has no index signature (each field is a specific
  // literal union, not a bare `string`), so it isn't structurally assignable
  // to `buildQuery`'s `Record<string, ...>` parameter without this cast —
  // every value in it is still a string/number/undefined at runtime.
  return superAdminFetch<DeveloperListPage>(
    `/v1/super-admin/developers${buildQuery(params as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}

export function getDeveloper(token: string, id: string): Promise<DeveloperDetail> {
  return superAdminFetch<DeveloperDetail>(`/v1/super-admin/developers/${id}`, { token });
}

export function suspendDeveloper(token: string, id: string, reason: string): Promise<SuspendResult> {
  return superAdminFetch<SuspendResult>(`/v1/super-admin/developers/${id}/suspend`, {
    token,
    method: 'POST',
    body: { reason },
  });
}

export function unsuspendDeveloper(token: string, id: string, reason: string): Promise<SuspendResult> {
  return superAdminFetch<SuspendResult>(`/v1/super-admin/developers/${id}/unsuspend`, {
    token,
    method: 'POST',
    body: { reason },
  });
}
