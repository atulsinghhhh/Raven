'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Project } from '@/lib/api-client';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { IconChevronDown, IconFolder, IconPlus, IconSearch, IconSettings } from '@/components/ui/icons';

/**
 * Switching projects keeps you on the same section where that makes
 * sense: if you're looking at Errors for one project, you almost always
 * want Errors for the next one, not its Overview. Detail routes fall back
 * to the section root, since an id from one project never resolves in
 * another.
 */
function targetPath(pathname: string, currentId: string, nextId: string): string {
  const match = pathname.match(/^\/dashboard\/projects\/[^/]+\/([^/]+)/);
  const section = match?.[1];
  if (!section || currentId === nextId) return `/dashboard/projects/${nextId}/overview`;
  return `/dashboard/projects/${nextId}/${section}`;
}

export function ProjectSwitcher({
  projects,
  current,
}: {
  projects: Project[];
  current: Project;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Menu
      label="Switch project"
      className="w-full"
      menuClassName="w-[15rem]"
      trigger={({ open }) => (
        <span
          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
            open ? 'border-line-strong bg-surface-raised' : 'border-line bg-surface hover:bg-surface-raised'
          }`}
        >
          <IconFolder className="size-4 shrink-0 text-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{current.name}</span>
          </span>
          <IconChevronDown className={`size-3.5 shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      )}
    >
      <ProjectSearchList
        projects={projects}
        current={current}
        onSelect={(id) => router.push(targetPath(pathname, current.id, id))}
      />
      <MenuSeparator />
      <MenuItem href="/dashboard/projects" icon={<IconFolder className="size-3.5" />}>
        All projects
      </MenuItem>
      <MenuItem href="/dashboard/projects?new=1" icon={<IconPlus className="size-3.5" />}>
        New project
      </MenuItem>
      <MenuItem
        href={`/dashboard/projects/${current.id}/settings`}
        icon={<IconSettings className="size-3.5" />}
      >
        Project settings
      </MenuItem>
    </Menu>
  );
}

/**
 * Split out so its `query` state remounts (and so resets) every time the
 * menu opens: the parent Menu only renders its children while open, so
 * this component's lifetime is exactly one open/close cycle.
 */
function ProjectSearchList({
  projects,
  current,
  onSelect,
}: {
  projects: Project[];
  current: Project;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed ? projects.filter((p) => p.name.toLowerCase().includes(trimmed)) : projects;

  return (
    <>
      {projects.length > 6 && (
        // Stops the click from bubbling to the menu's own "close on click
        // inside" handler: otherwise focusing the input closes the menu.
        <div className="relative px-1 pb-1" onClick={(e) => e.stopPropagation()}>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a project…"
            aria-label="Find a project"
            className="w-full rounded-sm border border-line bg-surface py-1.5 pl-7 pr-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}
      <MenuLabel>Projects</MenuLabel>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-3 text-center text-xs text-subtle">No projects match “{query.trim()}”.</p>
        ) : (
          filtered.map((p) => (
            <MenuItem key={p.id} selected={p.id === current.id} onClick={() => onSelect(p.id)}>
              {p.name}
            </MenuItem>
          ))
        )}
      </div>
    </>
  );
}
