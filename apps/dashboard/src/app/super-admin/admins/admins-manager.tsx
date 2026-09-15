'use client';

import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Select, TextareaField } from '@/components/ui/field';
import { IconCli } from '@/components/ui/icons';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { PlatformAdminRow, PlatformRoleName } from '@/lib/super-admin/ops';
import { errorMessage, readJson } from '@/lib/client-fetch';

const ROLE_OPTIONS: PlatformRoleName[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'READ_ONLY'];

const ROLE_TONE: Record<PlatformRoleName, BadgeTone> = {
  SUPER_ADMIN: 'danger',
  ADMIN: 'accent',
  SUPPORT: 'info',
  READ_ONLY: 'neutral',
};

const ROLE_LABEL: Record<PlatformRoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SUPPORT: 'Support',
  READ_ONLY: 'Read only',
};

/**
 * Grant/revoke UI is only rendered at all when `canManage` (the viewer is
 * a SUPER_ADMIN) — for anyone else this is a read-only list. That's a UX
 * courtesy, not the security boundary: `POST`/`DELETE
 * /v1/super-admin/admins` re-check `SUPER_ADMIN` server-side regardless
 * of what this component renders.
 */
export function AdminsManager({
  initialAdmins,
  currentAdminId,
  canManage,
}: {
  initialAdmins: PlatformAdminRow[];
  currentAdminId: string;
  canManage: boolean;
}) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [email, setEmail] = useState('');
  const [platformRole, setPlatformRole] = useState<PlatformRoleName>('SUPPORT');
  const [reason, setReason] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();
  const [revokeError, setRevokeError] = useState<string>();
  const [confirmingId, setConfirmingId] = useState<string>();
  const [confirmReason, setConfirmReason] = useState('');

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    setGranting(true);
    setGrantError(undefined);

    try {
      const res = await fetch('/api/super-admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, platformRole, reason }),
      });
      const payload = await readJson<PlatformAdminRow>(res);

      if (!res.ok || !payload) {
        setGrantError(errorMessage(payload, 'Could not grant platform access'));
        return;
      }

      setAdmins((prev) => {
        const withoutExisting = prev.filter((a) => a.id !== payload.id);
        return [...withoutExisting, payload].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      setEmail('');
      setReason('');
      setPlatformRole('SUPPORT');
    } catch {
      setGrantError('Could not reach the server.');
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(userId: string) {
    setRevokingId(userId);
    setRevokeError(undefined);

    try {
      const res = await fetch(`/api/super-admin/admins/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: confirmReason }),
      });

      if (!res.ok && res.status !== 204) {
        const payload = await readJson(res);
        setRevokeError(errorMessage(payload, 'Could not revoke platform access'));
        return;
      }

      setAdmins((prev) => prev.filter((a) => a.id !== userId));
      setConfirmingId(undefined);
      setConfirmReason('');
    } catch {
      setRevokeError('Could not reach the server.');
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card>
          <CardHeader
            title="Grant platform access"
            subtitle="Requires the developer's existing email and a stated reason. This is a SUPER_ADMIN-only action, recorded in the Admin Audit Log."
          />
          <form onSubmit={handleGrant} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <Field
                id="grant-email"
                label="Developer email"
                type="email"
                placeholder="dev@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select
                id="grant-role"
                label="Platform role"
                value={platformRole}
                onChange={(e) => setPlatformRole(e.target.value as PlatformRoleName)}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            </div>
            <TextareaField
              id="grant-reason"
              label="Reason"
              placeholder="Why this developer needs platform access"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div>
              <Button type="submit" loading={granting}>
                Grant access
              </Button>
            </div>
          </form>
          {grantError && (
            <div className="mt-4">
              <ErrorState description={grantError} />
            </div>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title="Platform admins"
            subtitle={`${admins.length} account(s) with Super Admin Portal access.`}
          />
        </div>

        {revokeError && (
          <div className="px-5 pb-2">
            <ErrorState description={revokeError} />
          </div>
        )}

        {admins.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<IconCli className="size-6" />}
              title="No platform admins"
              description="Nobody currently holds a platform role."
            />
          </div>
        ) : (
          <>
            <TableWrap className="hidden rounded-none border-0 sm:block">
              <Table>
                <THead>
                  <TH>Email</TH>
                  <TH>Name</TH>
                  <TH align="right">Role</TH>
                  <TH>Granted</TH>
                  {canManage && <TH align="right">Actions</TH>}
                </THead>
                <TBody>
                  {admins.map((admin) => {
                    const isSelf = admin.id === currentAdminId;
                    return (
                      <TR key={admin.id}>
                        <TD>
                          <span className="text-sm text-fg">{admin.email}</span>
                          {isSelf && <span className="ml-2 text-xs text-subtle">(you)</span>}
                        </TD>
                        <TD>
                          <span className="text-sm text-muted">{admin.name ?? '—'}</span>
                        </TD>
                        <TD align="right">
                          <Badge tone={ROLE_TONE[admin.platformRole]}>{ROLE_LABEL[admin.platformRole]}</Badge>
                        </TD>
                        <TD>
                          <span className="text-xs text-subtle">{formatDate(admin.createdAt)}</span>
                        </TD>
                        {canManage && (
                          <TD align="right">
                            {isSelf ? (
                              <span className="text-xs text-subtle">Cannot revoke own role</span>
                            ) : confirmingId === admin.id ? (
                              <div className="flex flex-col items-end gap-2">
                                <input
                                  type="text"
                                  autoFocus
                                  aria-label="Reason for revoking platform access"
                                  placeholder="Reason for revoking"
                                  value={confirmReason}
                                  onChange={(e) => setConfirmReason(e.target.value)}
                                  className="w-56 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-subtle focus:border-line-strong"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmingId(undefined)}
                                    disabled={revokingId === admin.id}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={!confirmReason.trim() || revokingId === admin.id}
                                    onClick={() => handleRevoke(admin.id)}
                                  >
                                    {revokingId === admin.id ? 'Revoking…' : 'Confirm revoke'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button variant="danger" size="sm" onClick={() => setConfirmingId(admin.id)}>
                                Revoke
                              </Button>
                            )}
                          </TD>
                        )}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>

            <div className="px-5 pb-5 sm:hidden">
              <MobileList>
                {admins.map((admin) => {
                  const isSelf = admin.id === currentAdminId;
                  return (
                    <MobileRow key={admin.id}>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <span className="text-sm font-medium text-fg">
                          {admin.email}
                          {isSelf && <span className="ml-1.5 text-xs text-subtle">(you)</span>}
                        </span>
                        <Badge tone={ROLE_TONE[admin.platformRole]}>{ROLE_LABEL[admin.platformRole]}</Badge>
                      </div>
                      <MobileField label="Granted">{formatDate(admin.createdAt)}</MobileField>
                      {canManage && !isSelf && (
                        <div className="mt-2 flex flex-col gap-2">
                          <input
                            type="text"
                            aria-label="Reason for revoking platform access"
                            placeholder="Reason for revoking"
                            value={confirmingId === admin.id ? confirmReason : ''}
                            onFocus={() => setConfirmingId(admin.id)}
                            onChange={(e) => {
                              setConfirmingId(admin.id);
                              setConfirmReason(e.target.value);
                            }}
                            className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-subtle focus:border-line-strong"
                          />
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={confirmingId !== admin.id || !confirmReason.trim() || revokingId === admin.id}
                            onClick={() => handleRevoke(admin.id)}
                          >
                            {/* Matches the desktop table's label: once this second tap
                                is the actual irreversible action, it says so. */}
                            {revokingId === admin.id
                              ? 'Revoking…'
                              : confirmingId === admin.id
                                ? 'Confirm revoke'
                                : 'Revoke'}
                          </Button>
                        </div>
                      )}
                    </MobileRow>
                  );
                })}
              </MobileList>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
