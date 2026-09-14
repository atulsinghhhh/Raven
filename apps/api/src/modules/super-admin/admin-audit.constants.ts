import { ActivityEventType } from '../../generated/prisma/enums';

/**
 * Every action a Raven administrator can take, recorded in `AdminAuditLog`.
 * Flat list, same reasoning as `AuditAction` in the project-scoped audit
 * module: the value of this log is answering "what can appear here?"
 * without reading the code that writes it.
 */
export const AdminAction = {
  AdminLogin: 'admin.login',
  UserViewed: 'admin.user_viewed',
  ProjectViewed: 'admin.project_viewed',
  AccountSuspended: 'admin.account_suspended',
  AccountUnsuspended: 'admin.account_unsuspended',
  LimitChanged: 'admin.limit_changed',
  PlatformRoleGranted: 'admin.platform_role_granted',
  PlatformRoleRevoked: 'admin.platform_role_revoked',
  ApiKeyRevoked: 'admin.api_key_revoked',
  ProjectStateChanged: 'admin.project_state_changed',
} as const;

export type AdminAction = (typeof AdminAction)[keyof typeof AdminAction];

export const AdminTargetType = {
  User: 'user',
  Project: 'project',
  ApiKey: 'api_key',
  PlatformAdmin: 'platform_admin',
  UsageAllowance: 'usage_allowance',
} as const;

export type AdminTargetType = (typeof AdminTargetType)[keyof typeof AdminTargetType];

/**
 * Every admin mutation also gets mirrored into `ActivityEvent` so it shows
 * up in the unified Global Activity Explorer (§8), not just the dedicated
 * Audit Logs page (§9). Actions with no direct mapping fall back to the
 * generic `ADMIN_ACTION` type rather than failing to record at all.
 */
export const ADMIN_ACTION_EVENT_TYPE: Partial<Record<AdminAction, ActivityEventType>> = {
  [AdminAction.AdminLogin]: ActivityEventType.ADMIN_LOGIN,
  [AdminAction.UserViewed]: ActivityEventType.ADMIN_USER_VIEWED,
  [AdminAction.ProjectViewed]: ActivityEventType.ADMIN_PROJECT_VIEWED,
  [AdminAction.AccountSuspended]: ActivityEventType.ADMIN_ACCOUNT_SUSPENDED,
  [AdminAction.AccountUnsuspended]: ActivityEventType.ADMIN_ACCOUNT_UNSUSPENDED,
  [AdminAction.LimitChanged]: ActivityEventType.ADMIN_LIMIT_CHANGED,
};
