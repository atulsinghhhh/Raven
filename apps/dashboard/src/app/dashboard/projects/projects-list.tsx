'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Project } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, TextareaField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MonoId } from '@/components/ui/mono';
import { IconChevronRight, IconFolder, IconPlus, IconSearch } from '@/components/ui/icons';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

/**
 * Limits mirror CreateProjectDto on the API (name 2–80, description
 * optional and ≤500). They're enforced here as `maxLength` plus a
 * disabled submit rather than as an error message, so the two never
 * disagree and the request is never sent knowing it will be rejected —
 * but the server stays the authority, and anything it refuses is still
 * surfaced verbatim.
 */
const NAME_MIN = 2;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

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
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim().toLowerCase();
  const filteredProjects = trimmedQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(trimmedQuery))
    : projects;

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX;

  function openCreate() {
    setName('');
    setDescription('');
    setError(undefined);
    setCreating(true);
  }

  function closeCreate() {
    // Left alone while a request is in flight: dismissing the dialog
    // mid-submit would strand the user with no idea whether the project
    // was created.
    if (submitting) return;
    setCreating(false);
    setError(undefined);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!nameValid || submitting) return;

    setSubmitting(true);
    setError(undefined);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          // Omitted entirely rather than sent empty — the field is
          // optional on the API and "" is not the same as absent.
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
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
        eyebrow="Account"
        title="Projects"
        description="Each project has its own API keys, rooms, and observability data."
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="size-3.5" />
            New project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<IconFolder className="size-7" />}
          title="No projects yet"
          description="A project groups your API keys, rooms, and connection telemetry. Create one to get your first RTC token."
          action={
            <Button onClick={openCreate}>
              <IconPlus className="size-3.5" />
              Create your first project
            </Button>
          }
        />
      ) : (
        <>
          {projects.length > 6 && (
            <div className="relative max-w-sm">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
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
                      <IconChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                    </div>
                    {project.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{project.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <MonoId value={project.id} />
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs text-muted">
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

      <Dialog
        open={creating}
        onClose={closeCreate}
        title="Create a project"
        description="A project is an isolated set of API keys, rooms, and telemetry. You can rename it later."
        onSubmit={handleCreate}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeCreate} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!nameValid}>
              Create project
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            id="project-name"
            label="Project name"
            placeholder="my-video-app"
            required
            autoComplete="off"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={
              trimmedName.length === 0
                ? 'Used across the dashboard, CLI, and SDK quickstarts.'
                : trimmedName.length < NAME_MIN
                  ? `At least ${NAME_MIN} characters.`
                  : `${trimmedName.length} of ${NAME_MAX} characters.`
            }
          />

          <TextareaField
            id="project-description"
            label="Description (optional)"
            placeholder="What this project is for — shown on the projects list."
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            hint={
              description.length === 0
                ? `Up to ${DESCRIPTION_MAX} characters.`
                : `${description.length} of ${DESCRIPTION_MAX} characters.`
            }
          />

          {error && <ErrorState title="Could not create project" description={error} />}
        </div>
      </Dialog>
    </div>
  );
}
