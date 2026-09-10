'use client';

import { useState } from 'react';
import type { ApiKeySummary, CreatedApiKey, Environment } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Select } from '@/components/ui/field';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconKeys } from '@/components/ui/icons';
import { formatDate, formatRelative } from '@/lib/format';

/**
 * Every real environment a key can be scoped to: fixed set of 3, not
 * user-configurable (see apps/api/prisma/schema.prisma's Environment
 * enum). Production gets its own tone so it's never visually confused
 * with a development/staging key at a glance.
 */
const ENVIRONMENT_TONE: Record<Environment, BadgeTone> = {
  DEVELOPMENT: 'neutral',
  STAGING: 'info',
  PRODUCTION: 'warning',
};

const ENVIRONMENT_LABEL: Record<Environment, string> = {
  DEVELOPMENT: 'Development',
  STAGING: 'Staging',
  PRODUCTION: 'Production',
};

/**
 * Livqeno only ever stores a bcrypt hash of a key's secret half
 * (docs/control-plane.md, "API keys: the show-once secret"), so the
 * secret exists in the UI for exactly one render, right after creation.
 * Everything else in here shows the `publicId` and an explicit mask, so
 * it's never ambiguous whether the secret is retrievable: it isn't.
 *
 * The Control API backs exactly three operations: list, create, revoke.
 * There is no server-side rotate endpoint: the "Rotate" action below is
 * a client-side convenience that performs the two real calls in the safe
 * order (create the replacement first, then revoke the old key), never a
 * fourth API operation pretending to be atomic.
 */
export function ApiKeysManager({ projectId, initialKeys }: { projectId: string; initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<Environment>('DEVELOPMENT');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey>();
  const [error, setError] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();
  const [rotatingId, setRotatingId] = useState<string>();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(undefined);
    setJustCreated(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined, environment }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not create API key');
        return;
      }

      setJustCreated(payload);
      setKeys((prev) => [
        {
          id: payload.id,
          projectId,
          publicId: payload.publicId,
          name: payload.name,
          environment: payload.environment,
          status: 'ACTIVE',
          lastUsedAt: null,
          createdAt: payload.createdAt,
          revokedAt: null,
        },
        ...prev,
      ]);
      setName('');
      setEnvironment('DEVELOPMENT');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/api-keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Could not revoke key');
        return;
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === keyId ? { ...k, status: 'REVOKED', revokedAt: new Date().toISOString() } : k)),
      );
    } catch {
      setError('Could not reach the server.');
    } finally {
      setRevokingId(undefined);
    }
  }

  /**
   * Create the replacement first, then revoke the old key: never the
   * other order, so a failure partway through never leaves the project
   * with zero active keys. If the revoke half fails, the new key still
   * exists and is surfaced; the old one is left active with an explicit
   * error, not silently retried.
   */
  async function handleRotate(oldKey: ApiKeySummary) {
    setRotatingId(oldKey.id);
    setError(undefined);
    setJustCreated(undefined);

    try {
      const createRes = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: oldKey.name ? `${oldKey.name} (rotated)` : undefined,
          environment: oldKey.environment,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        setError(created.message ?? 'Could not create the replacement key — the old key was not touched.');
        return;
      }

      const revokeRes = await fetch(`/api/projects/${projectId}/api-keys/${oldKey.id}`, { method: 'DELETE' });
      const revoked = revokeRes.ok || revokeRes.status === 204;
      if (!revoked) {
        setError('The new key was created, but revoking the old one failed — revoke it manually below.');
      }

      setJustCreated(created);
      setKeys((prev) => [
        {
          id: created.id,
          projectId,
          publicId: created.publicId,
          name: created.name,
          environment: created.environment,
          status: 'ACTIVE',
          lastUsedAt: null,
          createdAt: created.createdAt,
          revokedAt: null,
        },
        ...prev.map((k) =>
          k.id === oldKey.id && revoked ? { ...k, status: 'REVOKED', revokedAt: new Date().toISOString() } : k,
        ),
      ]);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setRotatingId(undefined);
    }
  }

  const activeCount = keys.filter((k) => k.status === 'ACTIVE').length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Create a key"
          subtitle="A key is a project-scoped backend credential. The full value is shown once, here, and never again."
        />
        {/* Hints live below the row, not inside the fields: a hint under
            one control pushes the others off its baseline and the row
            reads crooked. */}
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              id="key-name"
              label="Name (optional)"
              placeholder="production-server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Select
              id="key-environment"
              label="Environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as Environment)}
              className="sm:w-40"
            >
              <option value="DEVELOPMENT">Development</option>
              <option value="STAGING">Staging</option>
              <option value="PRODUCTION">Production</option>
            </Select>
            <Button type="submit" loading={creating}>
              Create key
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            The name is only a dashboard label — it has no effect on what the key can do. The environment decides
            where the key may act: set it correctly so a development credential can never be mistaken for one that
            reaches production.
          </p>
        </form>
        {error && (
          <div className="mt-4">
            <ErrorState description={error} />
          </div>
        )}
      </Card>

      {/* One-time reveal. aria-live so it is announced, not just seen. */}
      <div aria-live="polite">
        {justCreated && <SecretReveal created={justCreated} />}
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title="Keys"
            subtitle={
              keys.length > 0
                ? `${activeCount} active of ${keys.length} total. Revoked keys stay listed so an old credential is never mistaken for a missing one.`
                : undefined
            }
          />
        </div>

        {keys.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<IconKeys className="size-7" />}
              title="No API keys yet"
              description="Create one above to mint RTC tokens and read project data from your backend with @ravenkash/server, raven-sdk, or plain HTTP."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {keys.map((key) => (
              <KeyRow
                key={key.id}
                apiKey={key}
                revoking={revokingId === key.id}
                rotating={rotatingId === key.id}
                onRevoke={() => handleRevoke(key.id)}
                onRotate={() => handleRotate(key)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="How Livqeno stores your keys"
          subtitle="Why a lost secret can't be recovered, and what to do instead."
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold text-fg">Only a hash is stored</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              A full key is <span className="font-mono text-xs text-fg">publicId.secret</span>. Livqeno persists the{' '}
              <span className="font-mono text-xs text-fg">publicId</span> in the clear so it can find the right row, and
              stores the secret only as a peppered bcrypt hash. Nothing in the database — or in this dashboard — can
              turn that hash back into the secret. If you lose it, create a new key and revoke the old one.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-fg">Rotating a key</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              There is no rotate operation — rotation is just the two operations that do exist, in order, with an
              overlap so nothing goes down:
            </p>
            <ol className="mt-2.5 flex flex-col gap-1.5 text-sm text-muted">
              <RotateStep n={1}>Create a second key here.</RotateStep>
              <RotateStep n={2}>Deploy it to your backend and confirm traffic is flowing.</RotateStep>
              <RotateStep n={3}>Revoke the old key from the list above.</RotateStep>
            </ol>
          </div>
        </div>
        <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-subtle">
          Keys belong on a server you control. Never ship one to a browser, a mobile app, or a public repository — a
          key can mint tokens for any room in this project. Browsers should only ever receive a short-lived RTC token
          minted by your backend.
        </p>
      </Card>
    </div>
  );
}

function RotateStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="tabular mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[0.6875rem] font-medium text-muted">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The only place a secret is ever rendered. Deliberately loud: this is the
 * developer's single chance to copy it, and the API's own `warning` string
 * is shown verbatim rather than paraphrased.
 */
function SecretReveal({ created }: { created: CreatedApiKey }) {
  return (
    <section className="rounded-lg border border-warning-line bg-warning-subtle p-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning-text">
          <svg viewBox="0 0 16 16" className="size-5" fill="currentColor">
            <path d="M7.1 1.9a1 1 0 011.8 0l6.05 10.6A1 1 0 0114.05 14H1.95a1 1 0 01-.9-1.5L7.1 1.9zM8 5.25a.75.75 0 00-.75.75v3a.75.75 0 001.5 0V6A.75.75 0 008 5.25zM8 12.2a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-warning-text">
            Copy this key now — this is the only time it will ever be shown
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-warning-text">{created.warning}</p>

          <div className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs break-all text-fg">{created.key}</code>
            <CopyButton value={created.key} label="Copy key" className="self-start sm:self-auto" />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-warning-text">
            Store it in your backend&apos;s secret manager or environment (for example{' '}
            <span className="font-mono">RAVEN_API_KEY</span>). Once you navigate away, only the key ID half stays
            visible in the list below.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Single markup path at every breakpoint: the row reflows instead of
 * being duplicated into a separate mobile list, so a key's ID appears
 * exactly once in the document.
 */
function KeyRow({
  apiKey,
  revoking,
  rotating,
  onRevoke,
  onRotate,
}: {
  apiKey: ApiKeySummary;
  revoking: boolean;
  rotating: boolean;
  onRevoke: () => void;
  onRotate: () => void;
}) {
  const active = apiKey.status === 'ACTIVE';
  const nameId = `key-name-${apiKey.id}`;
  const [confirming, setConfirming] = useState<'revoke' | 'rotate' | null>(null);
  const busy = revoking || rotating;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={nameId} className="truncate text-sm font-medium text-fg">
            {apiKey.name || 'Unnamed key'}
          </span>
          <Badge tone={active ? 'success' : 'danger'}>{active ? 'Active' : 'Revoked'}</Badge>
          {apiKey.environment && (
            <Badge tone={ENVIRONMENT_TONE[apiKey.environment]} glyph={false}>
              {ENVIRONMENT_LABEL[apiKey.environment]}
            </Badge>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex min-w-0 items-center rounded-sm border border-line bg-surface-sunken px-2 py-1 font-mono text-xs">
            <span className="truncate text-fg">{apiKey.publicId}</span>
            <span aria-hidden="true" className="text-subtle">
              .
            </span>
            <span aria-hidden="true" className="tracking-[0.2em] text-subtle">
              ••••••••••••
            </span>
          </span>
          <CopyButton value={apiKey.publicId} iconOnly label="Copy key ID" />
          <span className="text-xs text-subtle">
            Key ID only — the secret half is hashed and cannot be shown again.
          </span>
        </div>

        <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <div className="flex items-baseline gap-1.5">
            <dt>Created</dt>
            <dd className="tabular text-fg">{formatDate(apiKey.createdAt)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Last used</dt>
            <dd className="tabular text-fg">
              {apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : 'Never used'}
            </dd>
          </div>
          {apiKey.revokedAt && (
            <div className="flex items-baseline gap-1.5">
              <dt>Revoked on</dt>
              <dd className="tabular text-fg">{formatRelative(apiKey.revokedAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      {active && (
        <div className="shrink-0">
          {confirming ? (
            <div className="flex flex-col items-end gap-2 rounded-lg border border-line bg-surface-sunken p-3 sm:w-64">
              <p className="text-xs leading-relaxed text-muted">
                {confirming === 'revoke'
                  ? 'Revoke this key? Anything using it stops working immediately — this can’t be undone.'
                  : 'Create a replacement key and revoke this one? The old key stops working as soon as the new one is created.'}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  aria-describedby={nameId}
                  disabled={busy}
                  onClick={() => {
                    if (confirming === 'revoke') onRevoke();
                    else onRotate();
                    setConfirming(null);
                  }}
                >
                  {confirming === 'revoke' ? (revoking ? 'Revoking…' : 'Confirm revoke') : rotating ? 'Rotating…' : 'Confirm rotate'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirming('rotate')} disabled={busy}>
                Rotate
              </Button>
              <Button variant="danger" size="sm" aria-describedby={nameId} onClick={() => setConfirming('revoke')} disabled={busy}>
                Revoke
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
