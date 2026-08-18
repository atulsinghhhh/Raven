'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

/**
 * DELETE /v1/projects/:id is an archive, not a destructive delete — the
 * copy says so rather than implying data loss. The typed confirmation is
 * kept: it's the only thing standing between a mis-click and a project
 * disappearing from every list in the dashboard.
 */
export function DangerZone({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const confirmed = confirmText === projectName;

  async function handleDelete() {
    setDeleting(true);
    setError(undefined);

    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Could not delete project');
        return;
      }
      router.push('/dashboard/projects');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-danger-line bg-surface">
      <div className="border-b border-danger-line bg-danger-subtle px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-danger-text">
          <span aria-hidden="true">
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
              <path d="M7.1 1.9a1 1 0 011.8 0l6.05 10.6A1 1 0 0114.05 14H1.95a1 1 0 01-.9-1.5L7.1 1.9zM8 5.25a.75.75 0 00-.75.75v3a.75.75 0 001.5 0V6A.75.75 0 008 5.25zM8 12.2a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </span>
          Danger zone
        </h2>
      </div>

      <div className="p-5">
        <CardHeader
          title="Archive this project"
          subtitle="The project stops appearing in the dashboard and its API keys stop working. Rooms, connections, and error history are retained, not destroyed."
        />

        {error && (
          <div className="mb-4">
            <ErrorState title="Could not archive this project" description={error} />
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            id="confirm-delete"
            label={`Type "${projectName}" to confirm`}
            value={confirmText}
            autoComplete="off"
            onChange={(e) => setConfirmText(e.target.value)}
            className="flex-1"
            hint="Case-sensitive, and must match the project name exactly."
          />
          <Button variant="danger" disabled={!confirmed || deleting} onClick={handleDelete}>
            {deleting ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </div>
    </section>
  );
}
