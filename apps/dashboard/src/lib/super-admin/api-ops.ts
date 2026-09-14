// Typed client for the Super Admin Portal's API operations slice
// (`/v1/super-admin/api/*`). Named `api-ops.ts`, not `api.ts`, so it can
// never be confused with `lib/api-client.ts` (the developer dashboard's
// own client). Goes through the same `superAdminFetch` BFF helper every
// other super-admin domain client uses — the API re-checks the platform
// role on every request regardless of what this file assumes.
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';
export type Environment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

/**
 * Mirrors `ApiOverviewResponse` in
 * `apps/api/src/modules/super-admin/api/api.service.ts` field for field.
 *
 * There is no per-request log table in this codebase, so this
 * deliberately has no request-volume, success/failure-rate, status-code,
 * latency, or top-endpoint fields — everything here is a real count from
 * either the `ApiKey` table or the platform `ActivityEvent` log.
 */
export interface ApiOverviewResponse {
  generatedAt: string;
  keys: {
    total: number;
    active: number;
    revoked: number;
    createdToday: number;
    createdThisWeek: number;
  };
  activity: {
    apiKeyCreatedToday: number;
    apiKeyRevokedToday: number;
    apiRequestFailedToday: number;
    rateLimitTriggeredToday: number;
    rateLimitTriggeredTotal: number;
  };
}

/** One row of the platform-wide key list. Never carries `secretHash` or a raw secret — the API never sends either. */
export interface ApiKeyListItem {
  id: string;
  publicId: string;
  name: string | null;
  environment: Environment;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  project: { id: string; name: string };
  owner: { email: string };
}

export interface ApiKeyListPage {
  items: ApiKeyListItem[];
  total: number;
}

export interface ApiKeyFilters {
  status?: ApiKeyStatus;
  projectId?: string;
  environment?: Environment;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** `GET /v1/super-admin/api/overview` — any platform role may read it. */
export function getApiOverview(token: string): Promise<ApiOverviewResponse> {
  return superAdminFetch<ApiOverviewResponse>('/v1/super-admin/api/overview', { token });
}

/** `GET /v1/super-admin/api/keys` — paginated, across every project. */
export function listApiKeys(token: string, filters: ApiKeyFilters = {}): Promise<ApiKeyListPage> {
  // Cast only: `ApiKeyFilters` is a plain interface, which TS does not
  // give an implicit string index signature, so it isn't structurally
  // assignable to `buildQuery`'s `Record<string, ...>` parameter even
  // though every property here is already one of the allowed value
  // types. Several sibling domain clients hit this same shape.
  return superAdminFetch<ApiKeyListPage>(
    `/v1/super-admin/api/keys${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}
