'use client';

import { useRef, useState } from 'react';
import type { ProjectMember, ProjectRole } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { ErrorState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';
import { errorMessage, readJson } from '@/lib/client-fetch';

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
      if (handleSessionExpiry(res)) return;
      const payload = await readJson<ProjectMember>(res);

      if (!res.ok || !payload) {
        const message = errorMessage(payload, 'Could not add this member');
        setError(message);
        toast.error(message);
        return;
      }

      setMembers((current) => [...current, payload]);
      setEmail('');
      toast.success('Member invited');
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
      toast.error('Could not reach the Control API. Nothing was changed.');
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
      if (handleSessionExpiry(res)) return;
      const payload = await readJson<ProjectMember>(res);

      if (!res.ok || !payload) {
        const message = errorMessage(payload, 'Could not change this role');
        setError(message);
        toast.error(message);
        return;
      }

      setMembers((current) => current.map((m) => (m.userId === member.userId ? payload : m)));
      toast.success('Member role updated');
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
      toast.error('Could not reach the Control API. Nothing was changed.');
    } finally {
      setBusyUserId(undefined);
    }
  }

  async function handleRemove(member: ProjectMember) {
    // The confirm gate lives in the row itself (InlineConfirm, same as
    // API key revoke/rotate) — restating a permanent action before it
    // fires, without the unstyled native window.confirm() this used to
    // reach for.
    setBusyUserId(member.userId);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: 'DELETE',
      });
      if (handleSessionExpiry(res)) return;

      if (!res.ok && res.status !== 204) {
        const payload = await readJson(res);
        const message = errorMessage(payload, 'Could not remove this member');
        setError(message);
        toast.error(message);
        return;
      }

      setMembers((current) => current.filter((m) => m.userId !== member.userId));
      toast.success('Member removed');
    } catch {
      setError('Could not reach the Control API. Nothing was changed.');
      toast.error('Could not reach the Control API. Nothing was changed.');
    } finally {
      setBusyUserId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorState title="That didn't work" description={error} />}

      {canManage && (
        <Card>
          <CardHeader
            title="Add a member"
            subtitle="They need an existing Livqeno account — there's no invitation flow yet, so an unknown address is refused rather than left pending."
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
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
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
              <MemberRow
                key={member.userId}
                member={member}
                isSelf={isSelf}
                isLastOwner={isLastOwner}
                mayEdit={mayEdit}
                busy={busy}
                viewerIsOwner={viewerIsOwner}
                onRoleChange={(nextRole) => handleRoleChange(member, nextRole)}
                onRemove={() => handleRemove(member)}
              />
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  isLastOwner,
  mayEdit,
  busy,
  viewerIsOwner,
  onRoleChange,
  onRemove,
}: {
  member: ProjectMember;
  isSelf: boolean;
  isLastOwner: boolean;
  mayEdit: boolean;
  busy: boolean;
  viewerIsOwner: boolean;
  onRoleChange: (role: ProjectRole) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Stays mounted across both the role-select/Remove state and the
  // confirm state (only its children swap) — see InlineConfirm's doc
  // comment for why restoring focus here, not inside InlineConfirm, is
  // this component's job.
  const actionsRef = useRef<HTMLDivElement>(null);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{member.name ?? member.email}</span>
          {isSelf && (
            <Badge tone="neutral" glyph={false}>
              you
            </Badge>
          )}
        </div>
        {member.name && <p className="truncate text-xs text-subtle">{member.email}</p>}
        <p className="mt-0.5 text-xs text-subtle">Added {formatDate(member.createdAt)}</p>
      </div>

      {mayEdit && !confirming && (
        <select
          aria-label={`Role for ${member.email}`}
          value={member.role}
          disabled={busy || isLastOwner}
          onChange={(e) => onRoleChange(e.target.value as ProjectRole)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg disabled:opacity-50"
        >
          {ROLES.filter((r) => r !== 'OWNER' || viewerIsOwner).map((r) => (
            <option key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      )}
      {!mayEdit && (
        <Badge tone={ROLE_TONE[member.role]} glyph={false}>
          {member.role.toLowerCase()}
        </Badge>
      )}

      {mayEdit && (
        <div ref={actionsRef} tabIndex={-1} className="outline-none">
          {confirming ? (
            <InlineConfirm
              message={`Remove ${member.name ?? member.email} from this project? They lose access immediately.`}
              confirmLabel="Confirm remove"
              busyLabel="Removing…"
              busy={busy}
              onCancel={() => {
                setConfirming(false);
                actionsRef.current?.focus();
              }}
              onConfirm={() => {
                onRemove();
                setConfirming(false);
                actionsRef.current?.focus();
              }}
            />
          ) : (
            <Button variant="secondary" disabled={busy || isLastOwner} onClick={() => setConfirming(true)}>
              Remove
            </Button>
          )}
        </div>
      )}

      {isLastOwner && (
        <p className="w-full text-xs text-subtle">
          The only owner — promote someone else first. A project with no owner can&apos;t be administered by anyone.
        </p>
      )}
    </li>
  );
}
