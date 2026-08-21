'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Project } from '@/lib/api-client';
import type { DashboardNotification } from '@/lib/notifications';
import { SystemStatusIndicator, type SystemStatus } from '@/components/ui/badge';
import { IconClose, IconExternal, IconHelp, IconMenu, RavenMark } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';
import { CommandPalette } from './command-palette';
import { NotificationsBell } from './notifications-bell';
import { ProjectSwitcher } from './project-switcher';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * The authenticated application shell: fixed sidebar on desktop, drawer
 * on mobile, sticky top bar with search/status/account.
 *
 * `systemStatus` is derived from the real /health response by the server
 * component that renders this — it is never assumed to be healthy, and a
 * failed health call shows as "unknown" rather than green.
 */
export function AppShell({
  children,
  projects,
  currentProject,
  email,
  systemStatus,
  notifications,
}: {
  children: React.ReactNode;
  projects: Project[];
  currentProject: Project;
  email?: string;
  systemStatus: SystemStatus;
  notifications: DashboardNotification[];
}) {
  const pathname = usePathname();
  // Holds the path the drawer was opened on. Any navigation changes
  // `pathname`, which closes the drawer as derived state — no effect
  // needed, and no chance of the new page rendering behind a stale
  // overlay.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const drawerOpen = openedAt === pathname;

  const setDrawerOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  // Locking scroll is a genuine external-system sync, so it stays an effect.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const sidebarBody = (
    <>
      <div className="px-3 pb-3">
        <ProjectSwitcher projects={projects} current={currentProject} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <SidebarNav projectId={currentProject.id} onNavigate={() => setDrawerOpen(false)} />
      </div>
      <div className="border-t border-line px-3 py-3">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
        >
          <IconExternal className="size-4 shrink-0 text-subtle" />
          Documentation
        </a>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-200 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <Link href="/dashboard/projects" className="flex items-center gap-2" aria-label="Raven home">
            <RavenMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight text-fg">Raven</span>
          </Link>
        </div>
        {sidebarBody}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-fade-in absolute inset-y-0 left-0 flex w-[17rem] flex-col border-r border-line bg-surface"
          >
            <div className="flex h-14 items-center justify-between px-4">
              <span className="flex items-center gap-2">
                <RavenMark className="size-6" />
                <span className="text-sm font-semibold text-fg">Raven</span>
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg"
              >
                <IconClose className="size-4" />
              </button>
            </div>
            {sidebarBody}
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:gap-3 lg:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg lg:hidden"
          >
            <IconMenu className="size-4" />
          </button>

          <div className="min-w-0 flex-1">
            <CommandPalette projectId={currentProject.id} />
          </div>

          <SystemStatusIndicator status={systemStatus} className="hidden md:inline-flex" />

          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Documentation"
            className="hidden size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
          >
            <IconHelp className="size-4" />
          </a>

          <NotificationsBell notifications={notifications} />
          <ThemeToggle />
          <UserMenu email={email} />
        </header>

        <main id="main" className="mx-auto max-w-[85rem] px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
