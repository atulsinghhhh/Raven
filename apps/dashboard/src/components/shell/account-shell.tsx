import Link from 'next/link';
import { IconExternal, RavenMark } from '@/components/ui/icons';
import { SystemStatusIndicator, type SystemStatus } from '@/components/ui/badge';
import { DOCS_URL } from '@/lib/nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Account-level chrome for pages that aren't scoped to a project (the
 * project list). No sidebar — there's no project to navigate within yet,
 * and an empty sidebar is worse than none.
 */
export function AccountShell({
  children,
  email,
  systemStatus,
}: {
  children: React.ReactNode;
  email?: string;
  systemStatus: SystemStatus;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-200 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[85rem] items-center gap-3 px-4 lg:px-6">
          <Link href="/dashboard/projects" className="flex items-center gap-2" aria-label="Raven home">
            <RavenMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight text-fg">Raven</span>
          </Link>

          <div className="flex-1" />

          <SystemStatusIndicator status={systemStatus} className="hidden md:inline-flex" />
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
          >
            <IconExternal className="size-3.5" />
            Docs
          </a>
          <ThemeToggle />
          <UserMenu email={email} />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[85rem] px-4 py-8 lg:px-6">
        {children}
      </main>
    </div>
  );
}
