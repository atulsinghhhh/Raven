'use client';

import { useEffect, useState } from 'react';
import { dismissToast, subscribeToToasts, type ToastItem, type ToastVariant } from '@/lib/toast';
import { IconClose } from './icons';

// Same palette as Badge's tones (components/ui/badge.tsx) and the same
// glyphs, so a toast reads as the same status language as everywhere else
// in the console rather than inventing a second one.
const VARIANT: Record<ToastVariant, { classes: string; glyph: string; live: 'polite' | 'assertive' }> = {
  success: { classes: 'border-success-line bg-success-subtle text-success-text', glyph: '●', live: 'polite' },
  info: { classes: 'border-info-line bg-info-subtle text-info-text', glyph: '●', live: 'polite' },
  warning: { classes: 'border-warning-line bg-warning-subtle text-warning-text', glyph: '▲', live: 'assertive' },
  error: { classes: 'border-danger-line bg-danger-subtle text-danger-text', glyph: '✕', live: 'assertive' },
};

/**
 * Mounted once, in the root layout — see app/layout.tsx. Renders nothing
 * (`null`) until a toast actually exists, so it costs nothing on pages
 * that never call `toast.*`.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      aria-label="Notifications"
    >
      {items.map((item) => {
        const variant = VARIANT[item.variant];
        return (
          <div
            key={item.id}
            role={item.variant === 'error' || item.variant === 'warning' ? 'alert' : 'status'}
            aria-live={variant.live}
            className={`animate-fade-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm shadow-raven-md ${variant.classes}`}
          >
            <span aria-hidden="true" className="mt-0.5 text-[0.6rem] leading-none">
              {variant.glyph}
            </span>
            <span className="flex-1 leading-relaxed">{item.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss notification"
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <IconClose className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
