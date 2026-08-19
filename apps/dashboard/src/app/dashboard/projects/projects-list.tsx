'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Project } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MonoId } from '@/components/ui/mono';
import { IconChevronRight, IconFolder, IconPlus, IconSearch } from '@/components/ui/icons';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

export function ProjectsList({
  initialProjects,
  autoOpenCreate = false,
}: {
  initialProjects: Project[];
  autoOpenCreate?: boolean;
}) {
  const router = useRouter();
  const projects = initialProjects; // creating navigates away, so the list never mutates in place
  const [creating, setCreating] = useState(autoOpenCreate);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim().toLowerCase();
  const filteredProjects = trimmedQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(trimmedQuery))
    : projects;

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
      <PageHeader
        title="Projects"
        description="Each project has its own API keys, rooms, and observability data."
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <IconPlus className="size-3.5" />
              New project
            </Button>
          )
        }
      />

      {creating && (
        <Card>
          <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              id="project-name"
              label="Project name"
              placeholder="my-video-app"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
              hint="Used across the dashboard, CLI, and SDK quickstarts."
            />
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>
                Create project
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreating(false);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
          {error && (
            <div className="mt-4">
              <ErrorState title="Could not create project" description={error} />
            </div>
          )}
        </Card>
      )}

      {projects.length === 0 && !creating ? (
        <EmptyState
          icon={<IconFolder className="size-7" />}
          title="No projects yet"
          description="A project groups your API keys, rooms, and connection telemetry. Create one to get your first RTC token."
          action={
            <Button onClick={() => setCreating(true)}>
              <IconPlus className="size-3.5" />
              Create your first project
            </Button>
          }
        />
      ) : (
        <>
          {projects.length > 6 && (
            <div className="relative max-w-sm">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a project by name…"
                aria-label="Find a project by name"
                className="pl-8"
              />
            </div>
          )}

          {filteredProjects.length === 0 ? (
            <EmptyState
              icon={<IconSearch className="size-7" />}
              title="No projects match"
              description={`Nothing found for "${query.trim()}". Try a different name.`}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProjects.map((project) => (
                <li key={project.id}>
                  <a
                    href={`/dashboard/projects/${project.id}/overview`}
                    className="group flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{project.name}</span>
                      <IconChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                    </div>
                    {project.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{project.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <MonoId value={project.id} />
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs text-subtle">
                      <Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {project.status === 'ACTIVE' ? 'Active' : 'Archived'}
                      </Badge>
                      <span className="ml-auto">Created {formatDate(project.createdAt)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
