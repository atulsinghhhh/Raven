'use client';

import { createContext, useContext } from 'react';
import type { Project } from './api-client';

/**
 * The current project, for client components that would otherwise need
 * it threaded down as a prop. Not a second source of truth: `project` and
 * `capabilities` are exactly what the server already resolved in
 * app/dashboard/projects/[projectId]/layout.tsx (project fetch, and the
 * same "find myself in listMembers" capabilities lookup members/page.tsx
 * already does) — this context only re-exposes them, it never fetches or
 * re-derives anything of its own. Switching projects is still a URL
 * navigation (see ProjectSwitcher): that re-runs the layout, which
 * produces a new `project`/`capabilities`, which this context just
 * passes through — there's no separate client-side "current project"
 * state that could drift from the URL.
 */
export interface ProjectContextValue {
  project: Project;
  projectId: string;
  capabilities: string[];
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  project,
  capabilities,
  children,
}: {
  project: Project;
  capabilities: string[];
  children: React.ReactNode;
}) {
  return (
    <ProjectContext.Provider value={{ project, projectId: project.id, capabilities }}>
      {children}
    </ProjectContext.Provider>
  );
}

/**
 * Throws outside a `<ProjectProvider>` rather than returning a null-ish
 * default — every real call site is somewhere under
 * app/dashboard/projects/[projectId]/, where a project is always
 * resolved, so a missing provider is a wiring bug worth failing loudly on
 * rather than quietly rendering as "no project".
 */
export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error('useProject() must be called from a component rendered under <ProjectProvider> (AppShell).');
  }
  return value;
}
