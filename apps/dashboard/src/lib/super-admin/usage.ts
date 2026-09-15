// Typed client for the platform-wide Usage & Limits console (spec §14).
// Mirrors the response shapes in
// apps/api/src/modules/super-admin/usage/usage.service.ts field for field —
// kept in sync by hand, same discipline every other super-admin domain
// client in this directory already follows (see overview.ts, activity.ts).
import { buildQuery, superAdminFetch } from '../super-admin-client';

export type UsageProduct = 'RTC' | 'CHAT' | 'LIVE_STREAMING';
export type UsageAlertBand = 'none' | '50' | '75' | '90' | '100';

export interface ProductUsageBreakdown {
  product: UsageProduct;
  /** False when the developer has never used this product — distinct from "used 0 of a real grant". */
  provisioned: boolean;
  unit: 'minutes' | 'messages';
  included: number;
  used: number;
  remaining: number;
  usedPercent: number;
  band: UsageAlertBand;
  exhaustedAt: string | null;
}

export interface UsageOverview {
  generatedAt: string;
  rtcMinutesThisMonth: number;
  chatMessagesThisMonth: number;
  liveStreamingHostHoursThisMonth: number;
  developersAtRisk: number;
  developersExhausted: number;
}

export interface DeveloperUsageRow {
  userId: string;
  email: string;
  products: ProductUsageBreakdown[];
  maxUsedPercent: number;
  maxBand: UsageAlertBand;
  flagged: boolean;
}

export interface DeveloperUsagePage {
  items: DeveloperUsageRow[];
  total: number;
}

export interface DailyUsageBucket {
  date: string;
  rtcMinutes: number;
  rtcSessions: number;
  liveStreamingMinutes: number;
  liveStreamingSessions: number;
}

export interface DeveloperUsageDetail {
  userId: string;
  email: string;
  createdAt: string;
  products: ProductUsageBreakdown[];
  daily: DailyUsageBucket[];
}

export interface ListUsageDevelopersFilters {
  search?: string;
  atRisk?: boolean;
  limit?: number;
  offset?: number;
  // Index signature so this satisfies `buildQuery`'s `Record<string, ...>`
  // parameter type structurally — TS otherwise rejects a named interface
  // there even though every declared property is already compatible.
  [key: string]: string | number | boolean | undefined;
}

export interface UpdateAllowanceInput {
  product: UsageProduct;
  includedMinutes?: number;
  includedCount?: number;
  reason: string;
}

/** `GET /v1/super-admin/usage/overview` — any platform role may read it. */
export function getUsageOverview(token: string): Promise<UsageOverview> {
  return superAdminFetch<UsageOverview>('/v1/super-admin/usage/overview', { token });
}

/** `GET /v1/super-admin/usage/developers` — paginated, per-developer breakdown. */
export function listUsageDevelopers(
  token: string,
  filters: ListUsageDevelopersFilters = {},
): Promise<DeveloperUsagePage> {
  return superAdminFetch<DeveloperUsagePage>(`/v1/super-admin/usage/developers${buildQuery(filters)}`, { token });
}

/** `GET /v1/super-admin/usage/developers/:userId` — one developer's full breakdown + 30-day trend. */
export function getDeveloperUsage(token: string, userId: string): Promise<DeveloperUsageDetail> {
  return superAdminFetch<DeveloperUsageDetail>(`/v1/super-admin/usage/developers/${userId}`, { token });
}

/**
 * `PATCH /v1/super-admin/usage/developers/:userId/allowance` — the one
 * mutating call in this domain. Requires SUPER_ADMIN or ADMIN server-side
 * and a non-empty `reason`; the API 400s without one.
 */
export function updateAllowance(
  token: string,
  userId: string,
  input: UpdateAllowanceInput,
): Promise<ProductUsageBreakdown> {
  return superAdminFetch<ProductUsageBreakdown>(`/v1/super-admin/usage/developers/${userId}/allowance`, {
    token,
    method: 'PATCH',
    body: input,
  });
}
