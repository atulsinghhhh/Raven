'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';
import {
  IconConnections,
  IconDiagnostics,
  IconErrors,
  IconKeys,
  IconMetrics,
  IconOverview,
  IconParticipants,
  IconQuickstart,
  IconRooms,
  IconSdk,
  IconSettings,
  IconUsage,
} from '@/components/ui/icons';

const ICONS: Record<NavItem['icon'], (p: { className?: string }) => React.JSX.Element> = {
  overview: IconOverview,
  rooms: IconRooms,
  connections: IconConnections,
  participants: IconParticipants,
  metrics: IconMetrics,
  errors: IconErrors,
  diagnostics: IconDiagnostics,
  keys: IconKeys,
  sdk: IconSdk,
  quickstart: IconQuickstart,
  usage: IconUsage,
  settings: IconSettings,
};

export function SidebarNav({ projectId, onNavigate }: { projectId: string; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Project" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && (
            <div className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">
              {group.label}
            </div>
          )}
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const href = `/dashboard/projects/${projectId}/${item.slug}`;
              // startsWith so detail routes (…/connections/conn_x) keep their
              // parent item highlighted.
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = ICONS[item.icon];

              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-accent-subtle font-medium text-accent-text'
                        : 'text-muted hover:bg-surface-raised hover:text-fg'
                    }`}
                  >
                    <Icon className={`size-4 shrink-0 ${active ? 'text-accent' : 'text-subtle group-hover:text-muted'}`} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
