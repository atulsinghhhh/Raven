'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SystemStatusIndicator, type SystemStatus } from '@/components/ui/badge';
import {
  IconAnalytics,
  IconClose,
  IconCli,
  IconExternal,
  IconFolder,
  IconGitHub,
  IconHelp,
  IconMenu,
  IconOverview,
  IconSettings,
  RavenMark,
} from '@/components/ui/icons';
import { ACCOUNT_NAV, DOCS_URL, GITHUB_URL, SUPPORT_URL, type AccountNavItem } from '@/lib/nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

const NAV_ICONS: Record<AccountNavItem['icon'], React.ComponentType<{ className?: string }>> = {
  overview: IconOverview,
  projects: IconFolder,
  developers: IconCli,
  analytics: IconAnalytics,
  settings: IconSettings,
};

/**
 * Account-level chrome: the sidebar you live in before entering a project
 * (Overview, Projects, Developers, Analytics, Settings). Project pages
 * keep their own AppShell — the two shells share tokens and components,
 * so switching between them reads as one product.
 *
 * Responsive contract: full sidebar on desktop, icon rail on tablet,
 * drawer behind a hamburger on mobile.
 */
export function AccountShell({
  children,
  email,
  name,
  systemStatus,
}: {
  children: React.ReactNode;
  email?: string;
  name?: string | null;
  systemStatus: SystemStatus;
}) {
  const pathname = usePathname();
  // Same derived-state trick as AppShell: any navigation changes
  // `pathname`, which closes the drawer without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const drawerOpen = openedAt === pathname;
  const setDrawerOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const navList = (compact: boolean) => (
    <nav aria-label="Account" className="flex flex-col gap-0.5 px-3">
      {ACCOUNT_NAV.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={compact ? item.label : undefined}
            onClick={() => setDrawerOpen(false)}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-accent-subtle font-medium text-accent-text'
                : 'text-muted hover:bg-surface-raised hover:text-fg'
            } ${compact ? 'justify-center px-0' : ''}`}
          >
            <Icon className={`size-4 shrink-0 ${active ? '' : 'text-subtle'}`} />
            {!compact && item.label}
          </Link>
        );
      })}
    </nav>
  );

  const bottomLinks = (compact: boolean) => (
    <div className="flex flex-col gap-0.5 border-t border-line px-3 py-3">
      <ExternalNavLink href={DOCS_URL} label="Documentation" icon={IconExternal} compact={compact} />
      <ExternalNavLink href={SUPPORT_URL} label="Support" icon={IconHelp} compact={compact} />
      <ExternalNavLink href={GITHUB_URL} label="GitHub" icon={IconGitHub} compact={compact} />
    </div>
  );

  const sidebarHeader = (
    <div className="flex h-14 items-center px-4">
      <Link href="/dashboard" className="flex items-center gap-2" aria-label="Raven home">
        <RavenMark className="size-6" />
        <span className="text-sm font-semibold tracking-tight text-fg">Raven</span>
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

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        {sidebarHeader}
        <div className="flex-1 overflow-y-auto pb-4 pt-1">{navList(false)}</div>
        {bottomLinks(false)}
      </aside>

      {/* Tablet icon rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col border-r border-line bg-surface md:flex lg:hidden">
        <div className="flex h-14 items-center justify-center">
          <Link href="/dashboard" aria-label="Raven home">
            <RavenMark className="size-6" />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto pb-4 pt-1">{navList(true)}</div>
        {bottomLinks(true)}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
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
            <div className="flex-1 overflow-y-auto pb-4 pt-1">{navList(false)}</div>
            {bottomLinks(false)}
          </div>
        </div>
      )}

      <div className="md:pl-14 lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:gap-3 lg:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg md:hidden"
          >
            <IconMenu className="size-4" />
          </button>

          <div className="flex-1" />

          <SystemStatusIndicator status={systemStatus} className="hidden md:inline-flex" />
          <ThemeToggle />
          <UserMenu email={email} name={name} />
        </header>

        <main id="main" className="mx-auto max-w-[85rem] px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function ExternalNavLink({
  href,
  label,
  icon: Icon,
  compact,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  compact: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg ${
        compact ? 'justify-center px-0' : ''
      }`}
    >
      <Icon className="size-4 shrink-0 text-subtle" />
      {!compact && label}
    </a>
  );
}
