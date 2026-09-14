'use client';

import { useRouter } from 'next/navigation';

/**
 * The directory's rows need to navigate on click (spec §5: "Clicking a
 * row opens the detail page"), which a plain server-rendered `<tr>` can't
 * do — `<a>` cannot wrap `<tr>` legally. This is the one client component
 * on the page; everything else (search, filter, sort, pagination) stays
 * server-rendered via plain links/forms, same as the rest of the console.
 */
export function DeveloperRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
      className="cursor-pointer transition-colors hover:bg-surface-raised"
    >
      {children}
    </tr>
  );
}
