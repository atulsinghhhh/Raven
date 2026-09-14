// The Super Admin Portal's BFF client. Deliberately separate from
// `api-client.ts` (the developer dashboard's client): different base
// concerns, different types, and a super-admin page importing from here
// can never accidentally reach for a developer-facing call shape. Same
// rule as `api-client.ts` otherwise — runs server-side only, the browser
// never sees the JWT, and this is the only file that knows the super-admin
// route prefix.
import { ApiError } from './api-client';

const API_BASE_URL = process.env.RAVEN_API_URL ?? 'http://localhost:4100';

export { ApiError };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token: string;
  body?: unknown;
}

/**
 * Every `/v1/super-admin/*` call goes through this. The API re-checks the
 * platform role on every one of these requests regardless of what the
 * frontend already knows (`PlatformRoleGuard`) — this client does not, and
 * must not, cache or assume authorization client-side.
 */
export async function superAdminFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
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

export type PlatformRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'READ_ONLY';

export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
  platformRole: PlatformRole;
}

export const superAdminApi = {
  /** What the console layout checks before rendering anything (§3). A 401/403 here means "not an admin," full stop. */
  me: (token: string) => superAdminFetch<AuthenticatedPlatformAdmin>('/v1/super-admin/me', { token }),
};

/** Builds a `URLSearchParams` string from a plain object, skipping undefined/empty values. Shared across every domain client to keep query-building identical. */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
