import { ProjectRole } from '../../generated/prisma/enums';

export { ProjectRole };

/**
 * What a member may do, expressed as capabilities rather than as role
 * checks scattered through controllers.
 *
 * The point of the indirection: `can(role, Capability.KeysManage)` states
 * the requirement, while `role === 'ADMIN' || role === 'OWNER'` states an
 * implementation of it. When a role's powers change, this file changes and
 * nothing else does.
 */
export const Capability = {
  /** See the project exists and read its non-sensitive settings. */
  ProjectRead: 'project:read',
  /** Rename it, change its settings. */
  ProjectWrite: 'project:write',
  /** Archive/delete it. Owner only: it takes every key and room with it. */
  ProjectDelete: 'project:delete',

  MembersRead: 'members:read',
  MembersManage: 'members:manage',

  /** Key metadata only. Secrets are never readable by anyone, at any role. */
  KeysRead: 'keys:read',
  KeysManage: 'keys:manage',

  WebhooksRead: 'webhooks:read',
  WebhooksManage: 'webhooks:manage',

  /** Create and close rooms, mint dashboard test tokens. */
  RoomsWrite: 'rooms:write',

  /** Conversation and presence metadata in the console. Never message bodies. */
  ChatRead: 'chat:read',

  /** Create/update/end live streams from the dashboard or CLI. Never mints host/viewer credentials: that stays API-key-only. */
  LiveStreamsWrite: 'live-streams:write',

  UsageRead: 'usage:read',
  AuditRead: 'audit:read',
  BillingManage: 'billing:manage',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/**
 * The whole authorization model, in one table.
 *
 * Two judgement calls worth stating plainly:
 *
 * - **Developers can manage API keys.** They are building the thing; making
 *   them ask an admin for a key every time would push people towards
 *   sharing one, which is worse. They cannot add members, change settings,
 *   or delete the project.
 * - **Billing sees usage and nothing else.** Not conversations, not
 *   connections, not keys. Someone who needs an invoice does not need a
 *   list of customer conversations, and spec §24 asks for project
 *   permissions to gate exactly that.
 */
const CAPABILITIES: Record<ProjectRole, readonly Capability[]> = {
  [ProjectRole.OWNER]: Object.values(Capability),

  [ProjectRole.ADMIN]: [
    Capability.ProjectRead,
    Capability.ProjectWrite,
    Capability.MembersRead,
    Capability.MembersManage,
    Capability.KeysRead,
    Capability.KeysManage,
    Capability.WebhooksRead,
    Capability.WebhooksManage,
    Capability.RoomsWrite,
    Capability.ChatRead,
    Capability.LiveStreamsWrite,
    Capability.UsageRead,
    Capability.AuditRead,
  ],

  [ProjectRole.DEVELOPER]: [
    Capability.ProjectRead,
    Capability.MembersRead,
    Capability.KeysRead,
    Capability.KeysManage,
    Capability.WebhooksRead,
    Capability.WebhooksManage,
    Capability.RoomsWrite,
    Capability.ChatRead,
    Capability.LiveStreamsWrite,
    Capability.UsageRead,
  ],

  [ProjectRole.VIEWER]: [
    Capability.ProjectRead,
    Capability.MembersRead,
    Capability.KeysRead,
    Capability.WebhooksRead,
    Capability.ChatRead,
    Capability.UsageRead,
  ],

  [ProjectRole.BILLING]: [Capability.ProjectRead, Capability.UsageRead, Capability.BillingManage],
};

export function can(role: ProjectRole, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: ProjectRole): readonly Capability[] {
  return CAPABILITIES[role];
}

/**
 * Only an owner may create or remove another owner.
 *
 * Without this an admin could promote themselves to owner, which makes the
 * OWNER role decorative, and demote the actual owner out of their own
 * project.
 */
export function canAssignRole(actorRole: ProjectRole, targetRole: ProjectRole): boolean {
  if (!can(actorRole, Capability.MembersManage)) {
    return false;
  }
  return targetRole === ProjectRole.OWNER ? actorRole === ProjectRole.OWNER : true;
}
