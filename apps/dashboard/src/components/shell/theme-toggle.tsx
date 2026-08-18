'use client';

import { useSyncExternalStore } from 'react';
import { IconMoon, IconSun } from '@/components/ui/icons';

type Theme = 'light' | 'dark';

/**
 * The `data-theme` attribute on <html> is the single source of truth —
 * the inline boot script in layout.tsx sets it before first paint, and
 * this button reads it rather than keeping a parallel copy that could
 * disagree with the page.
 *
 * Modelled as an external store because that attribute genuinely is one:
 * it lives outside React, and useSyncExternalStore is how a component
 * subscribes to that without a setState-in-effect round trip.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// The server has no way to know which theme the browser resolved, so it
// renders neutral and the real icon appears on hydration.
function getServerSnapshot(): Theme | null {
  return null;
}

function setTheme(next: Theme) {
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('raven-theme', next);
  } catch {
    // Private mode / storage disabled — the toggle still works for this session.
  }
  listeners.forEach((notify) => notify());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg"
    >
      {theme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </button>
  );
}
