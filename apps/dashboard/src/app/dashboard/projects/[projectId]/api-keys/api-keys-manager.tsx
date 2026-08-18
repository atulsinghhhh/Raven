'use client';

import { useState } from 'react';
import type { ApiKeySummary, CreatedApiKey } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { EmptyState, ErrorState } from '@/components/ui/states';

export function ApiKeysManager({ projectId, initialKeys }: { projectId: string; initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey>();
  const [error, setError] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(undefined);
    setJustCreated(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined }),
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
          status: 'ACTIVE',
          lastUsedAt: null,
          createdAt: payload.createdAt,
          revokedAt: null,
        },
        ...prev,
      ]);
      setName('');
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
      setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, status: 'REVOKED', revokedAt: new Date().toISOString() } : k)));
    } catch {
      setError('Could not reach the server.');
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Create a new key"
          subtitle="The full secret is shown only once, right here — Raven stores only a hash and can never show it again."
        />
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <Field id="key-name" label="Name (optional)" placeholder="production-server" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create key'}
          </Button>
        </form>
        {error && (
          <div className="mt-3">
            <ErrorState description={error} />
          </div>
        )}
        {justCreated && (
          <div className="mt-4">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">{justCreated.warning}</p>
            <CodeBlock language="text" code={justCreated.key} />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Existing keys" />
        {keys.length === 0 ? (
          <EmptyState title="No API keys yet" description="Create one above to start calling Raven's Control API from your backend." />
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {keys.map((key) => (
              <li key={key.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{key.name || 'Unnamed key'}</span>
                    <Badge tone={key.status === 'ACTIVE' ? 'green' : 'red'}>{key.status === 'ACTIVE' ? 'Active' : 'Revoked'}</Badge>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 font-mono">{key.publicId}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    Created {new Date(key.createdAt).toLocaleDateString()} · Last used{' '}
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'never'}
                  </div>
                </div>
                {key.status === 'ACTIVE' && (
                  <Button variant="danger" onClick={() => handleRevoke(key.id)} disabled={revokingId === key.id}>
                    {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
