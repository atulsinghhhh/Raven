'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ConnectionLifecycleState, RoomWithLiveState } from '@/lib/api-client';
import { IconClose, IconSearch } from '@/components/ui/icons';

const STATES: { value: ConnectionLifecycleState; label: string }[] = [
  { value: 'CONNECTED', label: 'Connected' },
  { value: 'CONNECTING', label: 'Connecting' },
  { value: 'RECONNECTING', label: 'Reconnecting' },
  { value: 'DISCONNECTED', label: 'Disconnected' },
  { value: 'FAILED', label: 'Failed' },
];

/**
 * Filters live in the URL, so a filtered view is shareable and survives
 * refresh. State and room map to real API query params; the text box is
 * an in-page filter over the already-fetched records (the API has no
 * search), which the page states explicitly beneath the table.
 */
export function ConnectionFilters({
  basePath,
  rooms,
  state,
  room,
  q,
}: {
  basePath: string;
  rooms: RoomWithLiveState[];
  state?: ConnectionLifecycleState;
  room?: string;
  q?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q ?? '');

  function withParams(next: Partial<{ state: string; room: string; q: string }>) {
    const params = new URLSearchParams();
    const merged = { state, room, q, ...next };
    if (merged.state) params.set('state', merged.state);
    if (merged.room) params.set('room', merged.room);
    if (merged.q) params.set('q', merged.q);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  const active = Boolean(state || room || q);

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
            aria-label="Filter by connection ID, participant, or room"
            placeholder="Filter by ID, participant, room…"
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
        <FilterChip href={withParams({ state: undefined })} active={!state}>
          All states
        </FilterChip>
        {STATES.map((s) => (
          <FilterChip key={s.value} href={withParams({ state: s.value })} active={state === s.value}>
            {s.label}
          </FilterChip>
        ))}

        {rooms.length > 0 && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
            <label htmlFor="room-filter" className="sr-only">
              Filter by room
            </label>
            <select
              id="room-filter"
              value={room ?? ''}
              onChange={(e) => router.push(withParams({ room: e.target.value || undefined }))}
              className="h-7 cursor-pointer rounded-full border border-line bg-surface px-2.5 text-xs text-fg transition-colors hover:border-line-strong"
            >
              <option value="">All rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        )}
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
