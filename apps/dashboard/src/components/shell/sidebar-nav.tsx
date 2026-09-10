'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';
import {
  IconAnalytics,
  IconAudit,
  IconChat,
  IconCli,
  IconConnections,
  IconConversations,
  IconDiagnostics,
  IconEffects,
  IconErrors,
  IconEvents,
  IconKeys,
  IconLiveStreaming,
  IconLogs,
  IconMembers,
  IconMetrics,
  IconOverview,
  IconParticipants,
  IconPresence,
  IconQuickstart,
  IconRooms,
  IconSdk,
  IconSettings,
  IconStreams,
  IconUsage,
  IconWebhooks,
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
  chat: IconChat,
  conversations: IconConversations,
  presence: IconPresence,
  'live-streaming': IconLiveStreaming,
  streams: IconStreams,
  effects: IconEffects,
  webhooks: IconWebhooks,
  members: IconMembers,
  audit: IconAudit,
  cli: IconCli,
  analytics: IconAnalytics,
  logs: IconLogs,
  events: IconEvents,
};

/**
 * The sidebar's "RTC" entry (slug `rooms`) is the landing page for a
 * whole product family. Connections and Participants moved out of the
 * global sidebar into that family's own ProductTabs bar (see
 * product-tabs.tsx), but should still light up the same sidebar item.
 * Chat and Live Streaming don't need this: their sub-routes already
 * nest under the `chat`/`live-streaming` path prefix.
 */
const SLUG_FAMILIES: Record<string, string[]> = {
  rooms: ['connections', 'participants'],
};

export function SidebarNav({ projectId, onNavigate }: { projectId: string; onNavigate?: () => void }) {
  const pathname = usePathname();

  // Longest matching slug wins. Without this, "chat" and
  // "chat/conversations" would both light up on the conversations page,
  // since one slug is a prefix of the other.
  const activeSlug = NAV_GROUPS.flatMap((group) => group.items)
    .map((item) => item.slug)
    .filter((slug) => {
      const candidates = [slug, ...(SLUG_FAMILIES[slug] ?? [])];
      return candidates.some((candidate) => {
        const href = `/dashboard/projects/${projectId}/${candidate}`;
        return pathname === href || pathname.startsWith(`${href}/`);
      });
    })
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav aria-label="Project" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && (
            <div className="px-2.5 pb-1.5 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-subtle uppercase">
              {group.label}
            </div>
          )}
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const href = `/dashboard/projects/${projectId}/${item.slug}`;
              // Detail routes (…/connections/conn_x) keep their parent item
              // highlighted, but only the most specific parent.
              const active = item.slug === activeSlug;
              const Icon = ICONS[item.icon];

              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-accent-subtle font-medium text-accent-text shadow-[inset_2px_0_0_0_var(--accent)]'
                        : 'text-muted hover:bg-surface-raised hover:text-fg'
                    }`}
                  >
                    <Icon
                      className={`size-4 shrink-0 ${active ? 'text-accent' : 'text-subtle group-hover:text-muted'}`}
                    />
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
