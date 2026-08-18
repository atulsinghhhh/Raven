'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { Project } from '@/lib/api-client';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { IconChevronDown, IconFolder, IconPlus, IconSettings } from '@/components/ui/icons';

/**
 * Switching projects keeps you on the same section where that makes
 * sense — if you're looking at Errors for one project, you almost always
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
      <MenuLabel>Projects</MenuLabel>
      {projects.map((p) => (
        <MenuItem
          key={p.id}
          selected={p.id === current.id}
          onClick={() => router.push(targetPath(pathname, current.id, p.id))}
        >
          {p.name}
        </MenuItem>
      ))}
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
