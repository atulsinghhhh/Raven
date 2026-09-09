'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { expandIndex, type CompactSearchIndex, type SearchRecord } from '../lib/search-wire';
import { highlight, rank, type RankedResult } from '../lib/rank';

/**
 * Search over every page, every heading.
 *
 * The index is fetched once, the first time the dialog opens: not on
 * page load. Someone reading a guide shouldn't pay for a feature they
 * haven't used, and the whole site is otherwise static HTML that needs
 * no JavaScript at all to read.
 *
 * Keyboard: ⌘K / Ctrl-K opens it from anywhere, `/` opens it unless
 * you're already typing in a field, ↑↓ move, Enter opens, Esc closes.
 */
export function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<SearchRecord[]>();
  const [indexError, setIndexError] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results: RankedResult[] = index ? rank(index, query) : [];

  // Fetch on first open only. StrictMode double-invokes this in dev; the
  // `index` guard makes the second run a no-op, not a second GET.
  useEffect(() => {
    if (!open || index || indexError) return;

    let cancelled = false;
    fetch('/search-index.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: CompactSearchIndex) => {
        // The payload is normalised to keep the download small; expanding it
        // once here means rank() and everything below it stay unaware.
        if (!cancelled) setIndex(expandIndex(data));
      })
      .catch(() => {
        if (!cancelled) setIndexError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, index, indexError]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const go = useCallback(
    (result: RankedResult) => {
      const { slug, anchor } = result.record;
      close();
      router.push(anchor ? `/${slug}#${anchor}` : `/${slug}`);
    },
    [close, router],
  );

  // Global shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }

      // `/` is a search shortcut on most docs sites, but it's also a
      // character: never steal it from someone mid-word in a field.
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
      return;
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-fg sm:w-56"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search docs</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 font-sans text-[10px] text-subtle sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-sm"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search every page and heading…"
                aria-label="Search documentation"
                aria-controls={listId}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent py-3.5 text-sm text-fg outline-none placeholder:text-subtle"
              />
              <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-subtle">esc</kbd>
            </div>

            <div id={listId} className="max-h-[60vh] overflow-y-auto">
              {indexError && (
                <p className="px-4 py-8 text-center text-sm text-subtle">
                  The search index could not be loaded. Every page is still reachable from the sidebar.
                </p>
              )}

              {!indexError && !index && <p className="px-4 py-8 text-center text-sm text-subtle">Loading…</p>}

              {index && query.trim().length < 2 && (
                <p className="px-4 py-8 text-center text-sm text-subtle">
                  Type at least two characters. Try <Hint>token</Hint>, <Hint>screen share</Hint>, or{' '}
                  <Hint>RAVEN_TOKEN</Hint>.
                </p>
              )}

              {index && query.trim().length >= 2 && results.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-subtle">
                  Nothing matches “{query.trim()}”. Search covers page text and code samples — try a single keyword.
                </p>
              )}

              <ul>
                {results.map((result, i) => (
                  <li key={`${result.record.slug}#${result.record.anchor ?? ''}`}>
                    <button
                      type="button"
                      onClick={() => go(result)}
                      onMouseEnter={() => setActive(i)}
                      aria-current={i === active}
                      className={`block w-full border-b border-line px-4 py-3 text-left transition-colors ${
                        i === active ? 'bg-accent-subtle' : 'hover:bg-surface-raised'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-fg">
                          <Marked text={result.record.title} query={query} />
                        </span>
                        {result.record.heading && (
                          <>
                            <ChevronIcon />
                            <span className="truncate text-sm text-muted">
                              <Marked text={result.record.heading} query={query} />
                            </span>
                          </>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-subtle">
                          {result.record.group}
                        </span>
                      </div>
                      {result.excerpt && (
                        <p className="mt-1 line-clamp-2 text-xs text-subtle">
                          <Marked text={result.excerpt} query={query} />
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {results.length > 0 && (
              <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-subtle">
                <span>↑↓ to navigate</span>
                <span>↵ to open</span>
                <span className="ml-auto">
                  {results.length} result{results.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Renders matched runs as <mark> without ever putting the query into HTML. */
function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded bg-accent-subtle px-0.5 text-accent-text">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-raised px-1 py-0.5 text-xs text-fg">{children}</code>;
}

/** True for inputs, textareas, and contenteditable: where `/` is a character, not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0 text-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
