'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, TextareaField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

/**
 * Name and description are the only two mutable fields the Control API
 * exposes (PATCH /v1/projects/:id). The save confirmation is text, not a
 * colour change, so it still reads without colour perception.
 */
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

  const dirty = name !== initialName || description !== initialDescription;

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
      <CardHeader title="General" subtitle="How this project is labelled across the dashboard, CLI, and SDK examples." />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorState title="Could not save changes" description={error} />}

        <Field
          id="settings-name"
          label="Project name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          hint="Shown in the project switcher and page headers. Renaming never changes the project ID or invalidates API keys."
        />

        <TextareaField
          id="settings-description"
          label="Description (optional)"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
          hint="A line of context for whoever opens this project next."
        />

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
          <span aria-live="polite" className="text-sm text-muted">
            {saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}
          </span>
        </div>
      </form>
    </Card>
  );
}
