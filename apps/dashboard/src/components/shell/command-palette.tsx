'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_GROUPS, DOCS_URL } from '@/lib/nav';
import {
  IconConnections,
  IconErrors,
  IconLiveStreaming,
  IconParticipants,
  IconPlus,
  IconRooms,
  IconSearch,
} from '@/components/ui/icons';
import type { SearchHit } from '@/app/api/projects/[projectId]/search/route';

type ActionItem = { type: 'action'; id: string; title: string; subtitle?: string; href: string; external?: boolean };
type Item = SearchHit | { type: 'page'; id: string; title: string; subtitle?: string; href: string } | ActionItem;

const GROUP_LABEL: Record<Item['type'], string> = {
  action: 'Actions',
  page: 'Go to',
  room: 'Rooms',
  connection: 'Connections',
  participant: 'Participants',
  error: 'Errors',
  stream: 'Live Streaming',
};

const GROUP_ORDER: Item['type'][] = ['action', 'page', 'connection', 'room', 'stream', 'participant', 'error'];

function ItemIcon({ type }: { type: Item['type'] }) {
  const cls = 'size-3.5 shrink-0 text-subtle';
  if (type === 'room') return <IconRooms className={cls} />;
  if (type === 'connection') return <IconConnections className={cls} />;
  if (type === 'participant') return <IconParticipants className={cls} />;
  if (type === 'error') return <IconErrors className={cls} />;
  if (type === 'stream') return <IconLiveStreaming className={cls} />;
  if (type === 'action') return <IconPlus className={cls} />;
  return <IconSearch className={cls} />;
}

export function CommandPalette({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pages: Item[] = useMemo(
    () =>
      NAV_GROUPS.flatMap((g) => g.items).map((item) => ({
        type: 'page' as const,
        id: item.slug,
        title: item.label,
        href: `/dashboard/projects/${projectId}/${item.slug}`,
      })),
    [projectId],
  );

  // Things you *do*, not places you go. Each still lands on a real page
  // instead of calling an endpoint from here, which would mean
  // duplicating that page's validation and error UI, but where the page
  // supports a deep link that opens its create UI, the action uses it.
  const actions: Item[] = useMemo(
    () => [
      {
        type: 'action' as const,
        id: 'create-api-key',
        title: 'Create API key',
        subtitle: 'API Keys',
        href: `/dashboard/projects/${projectId}/api-keys`,
      },
      {
        type: 'action' as const,
        id: 'create-project',
        title: 'Create project',
        subtitle: 'Projects',
        // ?new=1 is the deep link that opens the create dialog: the
        // dashboard home and the project switcher already use it. Without
        // the param this action only landed on the list and the developer
        // had to find the button themselves.
        href: `/dashboard/projects?new=1`,
      },
      {
        type: 'action' as const,
        id: 'open-docs',
        title: 'Open documentation',
        subtitle: DOCS_URL,
        href: DOCS_URL,
        external: true,
      },
    ],
    [projectId],
  );

  // Remote hits are only meaningful for the query that fetched them, so
  // they're gated on the query still being long enough, not being
  // cleared from an effect.
  const searchable = query.trim().length >= 2;

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedActions = q ? actions.filter((a) => a.title.toLowerCase().includes(q)) : actions;
    const matchedPages = q ? pages.filter((p) => p.title.toLowerCase().includes(q)) : pages;
    const all = [...matchedActions, ...matchedPages, ...(searchable ? hits : [])];
    return GROUP_ORDER.flatMap((type) => all.filter((i) => i.type === type));
  }, [query, actions, pages, hits, searchable]);

  const openPalette = useCallback(() => {
    setQuery('');
    setHits([]);
    setCursor(0);
    setOpen(true);
    // Focus after paint: the input isn't mounted yet on this tick.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // `open` is a dependency so the handler reads it directly rather than
  // through a state updater: updaters must stay pure, and openPalette
  // both sets state and focuses the DOM.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, openPalette]);

  // Debounced remote search. Short queries stay local (nav pages only);
  // one- and two-character queries match nearly every id and just burn
  // requests. All state writes happen inside the debounced callback, not
  // synchronously in the effect body.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('search failed');
        const payload = await res.json();
        setHits(payload.hits ?? []);
      } catch {
        // Aborted or failed: the palette keeps working as a page jumper.
        if (!controller.signal.aborted) setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, projectId]);

  const go = useCallback(
    (item: Item) => {
      setOpen(false);
      if (item.type === 'action' && item.external) {
        window.open(item.href, '_blank', 'noopener,noreferrer');
        return;
      }
      router.push(item.href);
    },
    [router],
  );

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && items[cursor]) {
      e.preventDefault();
      go(items[cursor]);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return <SearchTrigger onClick={openPalette} />;

  let rendered = -1;

  return (
    <>
      <SearchTrigger onClick={openPalette} />
      <div
        className="fixed inset-0 z-100 flex items-start justify-center bg-scrim px-4 pt-[12vh]"
        onClick={() => setOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          onClick={(e) => e.stopPropagation()}
          className="animate-scale-in w-full max-w-xl overflow-hidden rounded-xl border border-line bg-overlay shadow-raven-lg"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <IconSearch className="size-4 shrink-0 text-subtle" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              aria-activedescendant={items[cursor] ? `palette-item-${cursor}` : undefined}
              aria-autocomplete="list"
              placeholder="Search rooms, connections, participants, errors…"
              className="h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
            />
            {loading && <span className="text-xs text-subtle">Searching…</span>}
          </div>

          <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[22rem] overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">
                {query.trim().length < 2 ? 'Type at least two characters to search.' : `No matches for “${query}”.`}
              </p>
            ) : (
              GROUP_ORDER.map((type) => {
                const group = items.filter((i) => i.type === type);
                if (group.length === 0) return null;

                return (
                  <div key={type} className="mb-1 last:mb-0">
                    <div className="px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">
                      {GROUP_LABEL[type]}
                    </div>
                    {group.map((item) => {
                      rendered += 1;
                      const index = rendered;
                      return (
                        <div
                          key={`${item.type}-${item.id}`}
                          id={`palette-item-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={index === cursor}
                          onMouseEnter={() => setCursor(index)}
                          onClick={() => go(item)}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${
                            index === cursor ? 'bg-accent-subtle' : ''
                          }`}
                        >
                          <ItemIcon type={item.type} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{item.title}</span>
                            {item.subtitle && <span className="block truncate text-xs text-muted">{item.subtitle}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-line bg-surface-sunken px-3 py-2 text-[0.6875rem] text-subtle">
            <Hint keys="↑↓" label="navigate" />
            <Hint keys="↵" label="open" />
            <Hint keys="esc" label="close" />
            <span className="ml-auto">Searches the 200 most recent records</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">{keys}</kbd>
      {label}
    </span>
  );
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm text-subtle transition-colors hover:border-line-strong hover:text-muted"
    >
      <IconSearch className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">Search…</span>
      <kbd className="hidden shrink-0 rounded border border-line px-1 font-mono text-[0.6875rem] sm:inline">⌘K</kbd>
    </button>
  );
}
