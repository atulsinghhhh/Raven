'use client';

import type { DashboardNotification } from '@/lib/notifications';
import { IconBell } from '@/components/ui/icons';
import { formatRelative } from '@/lib/format';
import { Menu } from '@/components/ui/menu';

const KIND_LABEL: Record<DashboardNotification['kind'], string> = {
  system: 'System',
  webhook: 'Webhook',
  audit: 'Activity',
};

/**
 * Every item here comes from a real record (diagnostics, webhook health,
 * audit log) fetched server-side by the project layout — see
 * lib/notifications.ts. There is no unread-count persistence yet
 * (nothing in the API tells us what a developer has already seen), so
 * the badge is "how many right now", not "how many new".
 */
export function NotificationsBell({ notifications }: { notifications: DashboardNotification[] }) {
  const warningCount = notifications.filter((n) => n.severity === 'warning').length;

  return (
    <Menu
      label="Notifications"
      align="end"
      menuClassName="w-80 sm:w-96 p-0"
      trigger={() => (
        <span className="relative inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg">
          <IconBell className="size-4" />
          {warningCount > 0 && (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-danger" aria-hidden="true" />
          )}
        </span>
      )}
    >
      <div className="border-b border-line px-3 py-2.5">
        <span className="text-sm font-semibold text-fg">Notifications</span>
      </div>
      {notifications.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-subtle">Nothing to report right now.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {notifications.map((n) => (
            <li key={n.id}>
              <a href={n.href ?? '#'} className="block px-3 py-2.5 hover:bg-surface-raised">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-subtle">
                    {KIND_LABEL[n.kind]}
                  </span>
                  <span className="shrink-0 text-[0.6875rem] text-subtle">{formatRelative(n.timestamp)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-fg">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{n.description}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Menu>
  );
}
