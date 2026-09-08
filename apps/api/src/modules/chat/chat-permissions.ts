import { ChatMemberRole } from '../../generated/prisma/client';
import { ChatError } from './chat-error';
import { ChatErrorCode } from './chat.constants';

/**
 * Four coarse scopes, not a full RBAC system (spec §28). Roles are what
 * gets stored; scopes are derived. That indirection is the whole point;
 * adding `chat:pin` later is a change to this file, not a migration.
 */
export const CHAT_SCOPES = ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'] as const;
export type ChatScope = (typeof CHAT_SCOPES)[number];

const ROLE_SCOPES: Record<ChatMemberRole, ChatScope[]> = {
  MEMBER: ['chat:read', 'chat:send'],
  // Can delete anyone's message; still can't reconfigure the conversation.
  MODERATOR: ['chat:read', 'chat:send', 'chat:moderate'],
  ADMIN: ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'],
};

export function scopesForRole(role: ChatMemberRole): ChatScope[] {
  return [...ROLE_SCOPES[role]];
}

export function isChatScope(value: unknown): value is ChatScope {
  return typeof value === 'string' && (CHAT_SCOPES as readonly string[]).includes(value);
}

/**
 * Intersects what a role allows with what a token actually asked for, so
 * a token minted with only `chat:read` stays read-only even if the user
 * is an ADMIN. Least privilege wins in both directions.
 */
export function narrowScopes(roleScopes: ChatScope[], requested?: ChatScope[]): ChatScope[] {
  if (!requested || requested.length === 0) {
    return roleScopes;
  }
  return roleScopes.filter((scope) => requested.includes(scope));
}

export function assertScope(scopes: readonly string[], required: ChatScope, action: string): void {
  if (!scopes.includes(required)) {
    throw new ChatError(
      ChatErrorCode.PERMISSION_DENIED,
      `${action} requires the "${required}" permission`,
    );
  }
}
