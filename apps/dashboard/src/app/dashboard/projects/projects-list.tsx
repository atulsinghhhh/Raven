'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Project } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { EmptyState, ErrorState } from '@/components/ui/states';

export function ProjectsList({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const projects = initialProjects; // creating a project navigates away — no local list mutation needed
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not create project');
        return;
      }

      router.push(`/dashboard/projects/${payload.id}/overview`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Projects</h1>
        {!creating && <Button onClick={() => setCreating(true)}>New project</Button>}
      </div>

      {creating && (
        <Card>
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="flex-1">
              <Field id="project-name" label="Project name" placeholder="My Video App" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </form>
          {error && <div className="mt-3"><ErrorState description={error} /></div>}
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to get started."
          action={!creating && <Button onClick={() => setCreating(true)}>New project</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <a
              key={project.id}
              href={`/dashboard/projects/${project.id}/overview`}
              className="block rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
            >
              <div className="font-medium text-neutral-900 dark:text-neutral-100">{project.name}</div>
              <div className="text-xs text-neutral-500 mt-1 font-mono">{project.id}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
