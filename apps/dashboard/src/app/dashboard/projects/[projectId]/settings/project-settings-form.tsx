'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

export function ProjectSettingsForm({
  projectId,
  initialName,
  initialDescription,
}: {
  projectId: string;
  initialName: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not save changes');
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Project" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorState description={error} />}
        <Field id="settings-name" label="Project name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          id="settings-description"
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
