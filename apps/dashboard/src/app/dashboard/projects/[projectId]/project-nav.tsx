'use client';

import { usePathname } from 'next/navigation';

const TABS = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'rooms', label: 'Rooms' },
  { slug: 'usage', label: 'Usage' },
  { slug: 'api-keys', label: 'API Keys' },
  { slug: 'quickstart', label: 'Quickstart' },
  { slug: 'settings', label: 'Settings' },
] as const;

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Project sections" className="border-b border-neutral-200 dark:border-neutral-800">
      <ul className="flex gap-1 -mb-px">
        {TABS.map((tab) => {
          const href = `/dashboard/projects/${projectId}/${tab.slug}`;
          const active = pathname.startsWith(href);
          return (
            <li key={tab.slug}>
              <a
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-block px-3 py-2 text-sm font-medium border-b-2 ${
                  active
                    ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
