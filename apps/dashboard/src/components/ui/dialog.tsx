'use client';

import { useId, useRef } from 'react';
import { IconClose } from './icons';
import { useFocusTrap } from './use-focus-trap';

/**
 * Modal dialog. Rolled by hand for the same reason Menu is: this and the
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
 * readers announce what the dialog is for, not just "dialog".
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
   * inside its own form. The alternative, a button outside the form
   * pointing at it via the `form` attribute, reads fine but makes the
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
  const id = useId();

  useFocusTrap({ open, onClose, panelRef, initialFocusRef: bodyRef });

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
    <div className="fixed inset-0 z-100 flex items-start justify-center bg-scrim px-4 py-[10vh]" onClick={onClose}>
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
