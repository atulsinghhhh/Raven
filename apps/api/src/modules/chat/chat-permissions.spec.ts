import { ChatMemberRole } from '../../generated/prisma/client';
import { ChatError } from './chat-error';
import { assertScope, isChatScope, narrowScopes, scopesForRole } from './chat-permissions';
import { canImpersonate, resolveSubjectId, type ChatActor } from './auth/chat-actor.interface';

describe('scopesForRole', () => {
  it('gives a member read and send, nothing more', () => {
    expect(scopesForRole(ChatMemberRole.MEMBER)).toEqual(['chat:read', 'chat:send']);
  });

  it('adds moderation for a moderator, but not configuration', () => {
    const scopes = scopesForRole(ChatMemberRole.MODERATOR);
    expect(scopes).toContain('chat:moderate');
    expect(scopes).not.toContain('chat:manage');
  });

  it('gives an admin everything', () => {
    expect(scopesForRole(ChatMemberRole.ADMIN)).toHaveLength(4);
  });

  it('returns a fresh array each call, so a caller cannot mutate the role table', () => {
    const first = scopesForRole(ChatMemberRole.MEMBER);
    first.push('chat:manage');
    expect(scopesForRole(ChatMemberRole.MEMBER)).toEqual(['chat:read', 'chat:send']);
  });
});

describe('narrowScopes', () => {
  it('returns the full role scopes when nothing was requested', () => {
    expect(narrowScopes(scopesForRole(ChatMemberRole.ADMIN))).toHaveLength(4);
    expect(narrowScopes(scopesForRole(ChatMemberRole.ADMIN), [])).toHaveLength(4);
  });

  it('intersects rather than replaces — a request can only ever remove', () => {
    expect(narrowScopes(scopesForRole(ChatMemberRole.MEMBER), ['chat:read', 'chat:manage'])).toEqual(['chat:read']);
  });

  it('yields nothing when the request and the role do not overlap', () => {
    expect(narrowScopes(scopesForRole(ChatMemberRole.MEMBER), ['chat:manage'])).toEqual([]);
  });
});

describe('isChatScope', () => {
  it('accepts the four real scopes and rejects everything else', () => {
    expect(isChatScope('chat:read')).toBe(true);
    expect(isChatScope('chat:manage')).toBe(true);
    expect(isChatScope('chat:admin')).toBe(false);
    expect(isChatScope('*')).toBe(false);
    expect(isChatScope(null)).toBe(false);
  });
});

describe('assertScope', () => {
  it('passes when the scope is held', () => {
    expect(() => assertScope(['chat:read', 'chat:send'], 'chat:send', 'Sending')).not.toThrow();
  });

  it('throws PERMISSION_DENIED naming both the action and the missing scope', () => {
    expect(() => assertScope(['chat:read'], 'chat:moderate', 'Deleting a message')).toThrow(ChatError);
    expect(() => assertScope(['chat:read'], 'chat:moderate', 'Deleting a message')).toThrow(
      /Deleting a message requires the "chat:moderate" permission/,
    );
  });
});

describe('actor identity', () => {
  const client: ChatActor = {
    kind: 'client',
    projectId: 'p1',
    userId: 'alice',
    scopes: ['chat:read', 'chat:send'],
  };
  const server: ChatActor = {
    kind: 'server',
    projectId: 'p1',
    userId: null,
    scopes: ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'],
  };

  it('ignores a client actor\'s requested sender entirely', () => {
    // This single function is what makes "never trust client-provided
    // sender_id" structural rather than a rule everyone has to remember.
    expect(resolveSubjectId(client, 'bob')).toBe('alice');
    expect(resolveSubjectId(client, null)).toBe('alice');
  });

  it('lets a server actor act on behalf of a named user', () => {
    expect(resolveSubjectId(server, 'bob')).toBe('bob');
  });

  it('returns null for a server actor that named nobody, so the caller must handle it', () => {
    expect(resolveSubjectId(server, null)).toBeNull();
  });

  it('only allows impersonation server-side', () => {
    expect(canImpersonate(server)).toBe(true);
    expect(canImpersonate(client)).toBe(false);
  });
});
