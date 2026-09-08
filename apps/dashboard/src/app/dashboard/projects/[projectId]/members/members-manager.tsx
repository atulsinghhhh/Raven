'use client';

import { useState } from 'react';
import type { ProjectMember, ProjectRole } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';

/**
 * Member management.
 *
 * Two rules the API enforces, mirrored here so the UI doesn't offer an
 * action it knows will be refused:
 *
 *   1. Only an owner can grant or remove the OWNER role. An admin who
 *      could promote themselves would make the role decorative.
 *   2. A project always keeps at least one owner. The last one's remove
 *      and demote controls are disabled, with the reason stated: a
 *      project with no owner can't be administered by anyone, not even
 *      to appoint a replacement.
 *
 * These are checks, not the enforcement: the server refuses either way.
 * Doing it here too means the developer reads *why* instead of clicking
 * and getting a 400.
 */

const ROLES: readonly ProjectRole[] = ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER', 'BILLING'];

const ROLE_TONE: Record<ProjectRole, BadgeTone> = {
  OWNER: 'accent',
  ADMIN: 'info',
  DEVELOPER: 'neutral',
  VIEWER: 'gray',
  BILLING: 'gray',
};

const ROLE_SUMMARY: Record<ProjectRole, string> = {
  OWNER: 'Everything, including deleting the project.',
  ADMIN: 'Everything except deleting the project or creating another owner.',
  DEVELOPER: 'Keys, webhooks, and rooms — but not who has access.',
  VIEWER: 'Read-only.',
  BILLING: 'Usage and billing, and nothing else.',
};

export function MembersManager({
  projectId,
  initialMembers,
  currentUserEmail,
  canManage,
}: {
  projectId: string;
  initialMembers: ProjectMember[];
  currentUserEmail: string | null;
  canManage: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('DEVELOPER');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [busyUserId, setBusyUserId] = useState<string>();

  const viewerIsOwner = members.some((m) => m.email === currentUserEmail && m.role === 'OWNER');
  const ownerCount = members.filter((m) => m.role === 'OWNER').length;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not add this member');
        return;
      }

      setMembers((current) => [...current, payload as ProjectMember]);
      setEmail('');
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(member: ProjectMember, nextRole: ProjectRole) {
    setBusyUserId(member.userId);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not change this role');
        return;
      }

      setMembers((current) =>
        current.map((m) => (m.userId === member.userId ? (payload as ProjectMember) : m)),
      );
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
    } finally {
      setBusyUserId(undefined);
    }
  }

  async function handleRemove(member: ProjectMember) {
    setBusyUserId(member.userId);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: 'DELETE',
      });

      if (!res.ok && res.status !== 204) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.message ?? 'Could not remove this member');
        return;
      }

      setMembers((current) => current.filter((m) => m.userId !== member.userId));
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
    } finally {
      setBusyUserId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <ErrorState title="That didn't work" description={error} />
      )}

      {canManage && (
        <Card>
          <CardHeader
            title="Add a member"
            subtitle="They need an existing Raven account — there's no invitation flow yet, so an unknown address is refused rather than left pending."
          />
          <form onSubmit={handleAdd} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Email"
                id="member-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:w-48">
              <label htmlFor="member-role" className="text-xs font-medium text-fg">
                Role
              </label>
              <select
                id="member-role"
                value={role}
                onChange={(e) => setRole(e.target.value as ProjectRole)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
              >
                {ROLES.filter((r) => r !== 'OWNER' || viewerIsOwner).map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0) + r.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="primary" disabled={adding || !email}>
              {adding ? 'Adding…' : 'Add member'}
            </Button>
          </form>
          <p className="mt-3 text-xs text-subtle">{ROLE_SUMMARY[role]}</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`${members.length} member${members.length === 1 ? '' : 's'}`}
          subtitle="Capabilities come from the API, so this list never disagrees with what the server will actually allow."
        />
        <ul className="flex flex-col divide-y divide-line">
          {members.map((member) => {
            const isLastOwner = member.role === 'OWNER' && ownerCount === 1;
            const isSelf = member.email === currentUserEmail;
            // Only an owner may touch another owner: mirroring the API.
            const mayEdit = canManage && (member.role !== 'OWNER' || viewerIsOwner);
            const busy = busyUserId === member.userId;

            return (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">
                      {member.name ?? member.email}
                    </span>
                    {isSelf && (
                      <Badge tone="neutral" glyph={false}>
                        you
                      </Badge>
                    )}
                  </div>
                  {member.name && <p className="truncate text-xs text-subtle">{member.email}</p>}
                  <p className="mt-0.5 text-xs text-subtle">Added {formatDate(member.createdAt)}</p>
                </div>

                {mayEdit ? (
                  <select
                    aria-label={`Role for ${member.email}`}
                    value={member.role}
                    disabled={busy || isLastOwner}
                    onChange={(e) => handleRoleChange(member, e.target.value as ProjectRole)}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none disabled:opacity-50"
                  >
                    {ROLES.filter((r) => r !== 'OWNER' || viewerIsOwner).map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0) + r.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={ROLE_TONE[member.role]} glyph={false}>
                    {member.role.toLowerCase()}
                  </Badge>
                )}

                {mayEdit && (
                  <Button
                    variant="secondary"
                    disabled={busy || isLastOwner}
                    onClick={() => handleRemove(member)}
                  >
                    {busy ? 'Working…' : 'Remove'}
                  </Button>
                )}

                {isLastOwner && (
                  <p className="w-full text-xs text-subtle">
                    The only owner — promote someone else first. A project with no owner can&apos;t be
                    administered by anyone.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
