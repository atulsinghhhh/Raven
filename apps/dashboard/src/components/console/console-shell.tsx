'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconAudit,
  IconChat,
  IconClose,
  IconCli,
  IconErrors,
  IconEvents,
  IconKeys,
  IconLiveStreaming,
  IconMembers,
  IconMenu,
  IconOverview,
  IconRooms,
  IconServer,
  IconSettings,
  IconShield,
  IconUsage,
  RavenMark,
} from '@/components/ui/icons';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { SUPER_ADMIN_NAV_GROUPS, type SuperAdminNavItem } from '@/lib/super-admin-nav';
import type { AuthenticatedPlatformAdmin } from '@/lib/super-admin-client';

const NAV_ICONS: Record<SuperAdminNavItem['icon'], React.ComponentType<{ className?: string }>> = {
  overview: IconOverview,
  developers: IconMembers,
  activity: IconEvents,
  audit: IconAudit,
  rtc: IconRooms,
  chat: IconChat,
  live: IconLiveStreaming,
  api: IconKeys,
  usage: IconUsage,
  errors: IconErrors,
  security: IconShield,
  infrastructure: IconServer,
  admins: IconCli,
  settings: IconSettings,
};

const ROLE_LABEL: Record<AuthenticatedPlatformAdmin['platformRole'], string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SUPPORT: 'Support',
  READ_ONLY: 'Read only',
};

/**
 * The Super Admin Portal's chrome. Deliberately not `AccountShell`/`AppShell`
 * with a different nav prop: this needs to *read* as a different surface —
 * denser rows, mono labels on every identifier, a permanent "internal"
 * marker — not the developer dashboard with an admin section bolted on
 * (spec §2: "make the portal feel like an operations console"). Built from
 * the same `components/ui/*` primitives and CSS tokens as the dashboard,
 * so it's still unmistakably Raven, not a second design system.
 */
export function ConsoleShell({ children, admin }: { children: React.ReactNode; admin: AuthenticatedPlatformAdmin }) {
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const drawerOpen = openedAt === pathname;
  const setDrawerOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const navList = () => (
    <nav aria-label="Super Admin" className="flex flex-col gap-4 px-3">
      {SUPER_ADMIN_NAV_GROUPS.map((group, i) => (
        <div key={group.label ?? i} className="flex flex-col gap-0.5">
          {group.label && (
            <div className="mono-label px-2.5 pb-1 text-[10px] uppercase tracking-wider text-subtle">{group.label}</div>
          )}
          {group.items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-accent-subtle font-medium text-accent-text shadow-[inset_2px_0_0_0_var(--accent)]'
                    : 'text-muted hover:bg-surface-raised hover:text-fg'
                }`}
              >
                <Icon className={`size-4 shrink-0 ${active ? '' : 'text-subtle'}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const sidebarHeader = (
    <div className="flex h-14 items-center gap-2 px-4">
      <Link href="/super-admin" className="flex items-center gap-2" aria-label="Raven Super Admin">
        <RavenMark className="size-6" />
        <span className="mono-label text-[13px] font-medium text-fg">Super Admin</span>
      </Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-200 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface-sunken lg:flex">
        {sidebarHeader}
        <div className="flex-1 overflow-y-auto pb-4 pt-2">{navList()}</div>
        <div className="border-t border-line px-4 py-3">
          <div className="mono-label text-[10px] uppercase tracking-wider text-subtle">Internal · never shared with developers</div>
        </div>
      </aside>

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
                <span className="text-sm font-semibold text-fg">Super Admin</span>
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
            <div className="flex-1 overflow-y-auto pb-4 pt-2">{navList()}</div>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg lg:hidden"
          >
            <IconMenu className="size-4" />
          </button>

          <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-raised px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
            Internal
          </span>

          <div className="flex-1" />

          <span className="hidden text-xs text-muted sm:inline">{admin.email}</span>
          <span className="mono-label rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent-text">
            {ROLE_LABEL[admin.platformRole]}
          </span>
          <ThemeToggle />
          <Link
            href="/dashboard"
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Exit console
          </Link>
        </header>

        <main id="main" className="mx-auto max-w-[95rem] px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
