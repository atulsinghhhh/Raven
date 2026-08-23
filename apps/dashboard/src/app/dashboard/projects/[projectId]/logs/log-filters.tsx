'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { LogProduct, LogStatus } from '@/lib/logs';
import { IconClose, IconSearch } from '@/components/ui/icons';

const PRODUCTS: { value: LogProduct; label: string }[] = [
  { value: 'rtc', label: 'RTC' },
  { value: 'chat', label: 'Chat' },
  { value: 'webhook', label: 'Webhooks' },
  { value: 'audit', label: 'Audit' },
];

/**
 * Filters live in the URL. Product and status are applied server-side
 * over the already-merged log list (see logs/page.tsx) — there's no
 * single backend endpoint to filter, so the page states that plainly
 * rather than implying a real query.
 */
export function LogFilters({
  basePath,
  product,
  status,
  q,
}: {
  basePath: string;
  product?: LogProduct;
  status?: LogStatus;
  q?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q ?? '');

  function withParams(next: Partial<{ product: string; status: string; q: string }>) {
    const params = new URLSearchParams();
    const merged = { product, status, q, ...next };
    if (merged.product) params.set('product', merged.product);
    if (merged.status) params.set('status', merged.status);
    if (merged.q) params.set('q', merged.q);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  const active = Boolean(product || status || q);

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push(withParams({ q: text.trim() || undefined }));
        }}
        className="flex items-center gap-2"
        role="search"
      >
        <div className="relative flex-1 sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Filter by event name or request ID"
            placeholder="Filter by event or request ID…"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2.5 text-sm text-fg transition-colors placeholder:text-subtle hover:border-line-strong focus:border-accent"
          />
        </div>
        {active && (
          <a
            href={basePath}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <IconClose className="size-3" />
            Clear
          </a>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip href={withParams({ product: undefined })} active={!product}>
          All products
        </FilterChip>
        {PRODUCTS.map((p) => (
          <FilterChip key={p.value} href={withParams({ product: p.value })} active={product === p.value}>
            {p.label}
          </FilterChip>
        ))}

        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden="true" />

        <FilterChip href={withParams({ status: undefined })} active={!status}>
          All statuses
        </FilterChip>
        <FilterChip href={withParams({ status: 'success' })} active={status === 'success'}>
          Success
        </FilterChip>
        <FilterChip href={withParams({ status: 'failed' })} active={status === 'failed'}>
          Failed
        </FilterChip>
      </div>
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-accent-line bg-accent-subtle text-accent-text'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {children}
    </a>
  );
}
