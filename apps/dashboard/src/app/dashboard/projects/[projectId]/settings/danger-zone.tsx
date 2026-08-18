'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

export function DangerZone({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

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
    <Card className="border-red-200 dark:border-red-900/50">
      <CardHeader title="Danger zone" subtitle="Archives this project — it stops appearing in the dashboard, but its history is retained." />
      {error && (
        <div className="mb-3">
          <ErrorState description={error} />
        </div>
      )}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field
            id="confirm-delete"
            label={`Type "${projectName}" to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </div>
        <Button variant="danger" disabled={confirmText !== projectName || deleting} onClick={handleDelete}>
          {deleting ? 'Deleting…' : 'Delete project'}
        </Button>
      </div>
    </Card>
  );
}
