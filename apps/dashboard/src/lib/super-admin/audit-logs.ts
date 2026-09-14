// Typed client for the Admin Audit Logs page (§9) — the immutable record of
// what Raven *administrators* did, distinct from `activity.ts`'s
// developer/business event stream. Mirrors `AdminAuditLog` in apps/api's
// Prisma schema field-for-field, and goes through the same `superAdminFetch`
// BFF helper every other super-admin domain client uses — the API
// re-checks the platform role on every request regardless of what this
// file assumes.
import { buildQuery, superAdminFetch } from '../super-admin-client';

/**
 * Every admin action `AdminAuditLog.action` can hold. Mirrors `AdminAction`
 * in apps/api/src/modules/super-admin/admin-audit.constants.ts — kept as a
 * plain const here since a Nest-side file can't be imported into the
 * dashboard. Update both places together if the enum changes.
 */
export const ADMIN_ACTIONS = [
  'admin.login',
  'admin.user_viewed',
  'admin.project_viewed',
  'admin.account_suspended',
  'admin.account_unsuspended',
  'admin.limit_changed',
  'admin.platform_role_granted',
  'admin.platform_role_revoked',
  'admin.api_key_revoked',
  'admin.project_state_changed',
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const ADMIN_TARGET_TYPES = ['user', 'project', 'api_key', 'platform_admin', 'usage_allowance'] as const;

export type AdminTargetType = (typeof ADMIN_TARGET_TYPES)[number];

export interface AdminAuditLog {
  id: string;
  publicId: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminAuditLogPage {
  items: AdminAuditLog[];
  total: number;
}

export interface AdminAuditLogFilters {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** `GET /v1/super-admin/audit-logs` — the Admin Audit Logs page's one data source. */
export function listAdminAuditLogs(token: string, filters: AdminAuditLogFilters = {}): Promise<AdminAuditLogPage> {
  return superAdminFetch<AdminAuditLogPage>(
    `/v1/super-admin/audit-logs${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}
