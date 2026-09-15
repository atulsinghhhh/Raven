/**
 * Capability names, mirrored from apps/api/src/modules/projects/project-permissions.ts.
 *
 * Deliberately NOT a role → capability table. That table stays server-only
 * and server-authoritative: the API computes what a member's role grants
 * and sends the result as `ProjectMember.capabilities` (see the comment on
 * that field in api-client.ts), so the dashboard never re-derives "what
 * does ADMIN get" from a role. Duplicating that table here is exactly the
 * drift the backend comment warns about — two copies of the matrix, one of
 * which would eventually be wrong.
 *
 * What this file centralizes instead: the capability *names*, so call
 * sites write `can(capabilities, Capability.MembersManage)` instead of a
 * bare string, and one shared `can()` instead of every page re-writing
 * `.capabilities.includes(...)`.
 *
 * This is a UX layer only. Every mutation the dashboard makes is
 * re-checked by the Raven API regardless of what this returns — hiding a
 * button here is not a security boundary.
 */
export const Capability = {
  ProjectRead: 'project:read',
  ProjectWrite: 'project:write',
  ProjectDelete: 'project:delete',

  MembersRead: 'members:read',
  MembersManage: 'members:manage',

  KeysRead: 'keys:read',
  KeysManage: 'keys:manage',

  WebhooksRead: 'webhooks:read',
  WebhooksManage: 'webhooks:manage',

  RoomsWrite: 'rooms:write',

  ChatRead: 'chat:read',

  LiveStreamsWrite: 'live-streams:write',

  UsageRead: 'usage:read',
  AuditRead: 'audit:read',
  BillingManage: 'billing:manage',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/** `capabilities` is whatever the API sent for this viewer — `undefined` while it hasn't loaded, or on a viewer the API doesn't recognise (never treated as "can do everything"). */
export function can(capabilities: readonly string[] | undefined, capability: Capability): boolean {
  return (capabilities ?? []).includes(capability);
}

/**
 * Binds one viewer's capabilities once, for call sites that check several
 * capabilities against the same viewer (e.g. a page header building its
 * description) and would otherwise repeat that array on every call:
 *
 *   const can = createPermissionChecker(viewer?.capabilities);
 *   const canManage = can(Capability.MembersManage);
 */
export function createPermissionChecker(capabilities: readonly string[] | undefined) {
  const granted = new Set(capabilities ?? []);
  return (capability: Capability): boolean => granted.has(capability);
}
