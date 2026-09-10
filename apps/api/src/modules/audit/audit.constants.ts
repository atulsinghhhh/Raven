/**
 * Every administrative action Livqeno records.
 *
 * Kept as one flat list, not composed from parts, because the value
 * of an audit log is being able to answer "what can appear here?" without
 * reading the code that writes it.
 */
export const AuditAction = {
  ApiKeyCreated: 'api_key.created',
  ApiKeyRevoked: 'api_key.revoked',

  MemberAdded: 'member.added',
  MemberRemoved: 'member.removed',
  MemberRoleChanged: 'member.role_changed',

  WebhookCreated: 'webhook.created',
  WebhookUpdated: 'webhook.updated',
  WebhookDeleted: 'webhook.deleted',

  ProjectCreated: 'project.created',
  ProjectUpdated: 'project.updated',
  ProjectArchived: 'project.archived',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResource = {
  ApiKey: 'api_key',
  Member: 'member',
  Webhook: 'webhook',
  Project: 'project',
} as const;

export type AuditResource = (typeof AuditResource)[keyof typeof AuditResource];
