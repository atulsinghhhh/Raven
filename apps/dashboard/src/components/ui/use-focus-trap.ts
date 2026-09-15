'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared focus-trap/restore contract for a full-panel overlay: Escape
 * closes, Tab/Shift+Tab cycle inside the panel and never escape it, focus
 * moves into the panel on open and back to whatever was focused before it
 * on close, body scroll locks while open.
 *
 * Extracted out of `Dialog` (this is exactly its own effect, unchanged)
 * so a second hand-rolled overlay — the mobile nav drawer in
 * `app-shell.tsx`, which declared `role="dialog" aria-modal="true"`
 * without actually implementing any of it — doesn't reimplement, or
 * silently skip, the same contract. `Dialog` and the drawer both call
 * this now; behavior for `Dialog` itself is unchanged.
 */
export function useFocusTrap({
  open,
  onClose,
  panelRef,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
  /** Scope searched for the first focusable target on open. Defaults to `panelRef` itself. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  // The last element focused while closed: where focus goes back to on
  // close, normally the trigger. Tracked continuously rather than read
  // from document.activeElement on open, because by then it can already
  // be wrong — see the identical note in Dialog's own history.
  const restoreTo = useRef<HTMLElement | null>(null);

  // Held in a ref so the effect below can depend on `open` alone; see
  // Dialog's own comment on why depending on a fresh `onClose` closure
  // directly re-runs the effect (and re-fires the open-focus) far more
  // often than intended.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) return;

    function onFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body) {
        restoreTo.current = target;
      }
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus after paint: the panel isn't in the DOM yet on this tick.
    const frame = requestAnimationFrame(() => {
      const scope = initialFocusRef?.current ?? panelRef.current;
      const target = scope?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      target?.focus();
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      // Visibility is filtered by attribute, not by offsetParent — see
      // Dialog's own note: offsetParent reports null for anything inside
      // a fixed-position ancestor, which this panel always is.
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      // Skip a node that has since been removed: focusing a detached
      // element is a no-op that drops focus to <body>.
      if (restoreTo.current?.isConnected) restoreTo.current.focus();
    };
  }, [open, panelRef, initialFocusRef]);
}
