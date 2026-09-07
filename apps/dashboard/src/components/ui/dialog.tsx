'use client';

import { useEffect, useId, useRef } from 'react';
import { IconClose } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog. Rolled by hand for the same reason Menu is — this and the
 * command palette are the only overlay patterns the console needs, and a
 * headless-UI dependency would cost more than the ~90 lines here.
 *
 * Keyboard and focus contract:
 *   - Escape closes.
 *   - Focus moves into the panel on open and returns to whatever was
 *     focused before it (usually the trigger) on close.
 *   - Tab and Shift+Tab cycle inside the panel and never escape it.
 *   - Clicking the scrim closes; clicking inside never does.
 *   - Body scroll is locked while open.
 *
 * The panel is labelled by its own heading via aria-labelledby, so screen
 * readers announce what the dialog is for rather than just "dialog".
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  onSubmit,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /**
   * When given, the body and footer are wrapped in a single <form>, so a
   * primary action rendered into `footer` is an ordinary submit button
   * inside its own form. The alternative — a button outside the form
   * pointing at it via the `form` attribute — reads fine but makes the
   * dialog's main action depend on that association being honoured.
   */
  onSubmit?: (e: React.FormEvent) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus targets are looked up inside the body, not the whole panel:
  // the header's close button is first in DOM order, and focusing it on
  // open means a Space or Enter right after opening dismisses the dialog
  // instead of typing into the first field.
  const bodyRef = useRef<HTMLDivElement>(null);
  // The last element focused while the dialog was closed — where focus
  // goes back to on close, normally the trigger.
  //
  // Tracked continuously rather than read from document.activeElement on
  // open, because by then it can already be wrong: anything React
  // focuses during commit (a child's autoFocus) lands before this
  // component's effects run, and restoring to a node inside the panel
  // focuses something about to unmount, dropping focus to <body>.
  const restoreTo = useRef<HTMLElement | null>(null);
  const id = useId();

  // Held in a ref so the effect below can depend on `open` alone.
  // Callers pass a fresh closure every render, and depending on it
  // directly made the effect tear down and re-run on every keystroke:
  // each run re-captured restoreTo (ending up on a field inside the
  // dialog instead of the trigger) and re-fired the open-focus, which
  // yanked the caret back to the first input mid-typing.
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

    // Focus after paint — the panel isn't in the DOM yet on this tick.
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      // The first control in the body, by DOM order. Callers should not
      // put autoFocus on a field to override this: React applies
      // autoFocus during commit, before the effects here run, which both
      // races this call and corrupts the focus-restore record.
      const target = body?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      target?.focus();
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      // Visibility is filtered by attribute, not by offsetParent. That
      // is the usual trick for "is this actually on screen", but it
      // reports null for anything inside a fixed-position ancestor — and
      // this panel is one — as well as everywhere in jsdom, where there
      // is no layout at all. Either way the list came back empty and the
      // trap silently did nothing. The selector already drops [disabled]
      // and tabindex="-1"; these two cover the rest.
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has somehow
      // landed outside the panel (browser chrome, an injected element).
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
      // Skip a node that has since been removed — focusing a detached
      // element is a no-op that drops focus to <body>.
      if (restoreTo.current?.isConnected) restoreTo.current.focus();
    };
  }, [open]);

  if (!open) return null;

  const body = (
    <>
      <div ref={bodyRef} className="px-5 py-5">
        {children}
      </div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3.5">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-100 flex items-start justify-center bg-scrim px-4 py-[10vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-scale-in flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-overlay shadow-raven-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-sm font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={`${id}-description`} className="mt-1 text-xs leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
      </div>
    </div>
  );
}
