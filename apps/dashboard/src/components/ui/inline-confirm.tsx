import { Button } from './button';

/**
 * Restate-before-it-fires guard for a destructive row action: API key
 * revoke/rotate, member remove, webhook delete. Extracted from the pattern
 * `api-keys-manager.tsx`'s `KeyRow` had on its own, so member and webhook
 * removal — equally permanent, equally one-click without this — get the
 * same themed, keyboard-accessible confirm instead of the unstyled native
 * `window.confirm()` they used before.
 *
 * Deliberately not a `Dialog`: this replaces the trigger button in place,
 * inline in the row it concerns, rather than covering the screen for a
 * one-line question next to data the person can already see.
 *
 * Focus moves to Cancel as soon as this mounts (`autoFocus`, not a manual
 * ref — the trigger button it replaces is a `Button`, which doesn't
 * forward one). The trigger is gone from the DOM in the same render that
 * introduces this, and without an explicit target a browser drops focus
 * to `<body>`, silently stranding a keyboard user at the top of the page.
 * Cancel, not Confirm: this is the one moment an accidental Enter must do
 * nothing, and Cancel is also the escape hatch for a screen-reader user
 * who arrows here by mistake.
 *
 * Restoring focus *back* to the trigger on cancel/confirm is the caller's
 * job, not this component's: the trigger is a sibling this never has a
 * reference to, and the caller already owns a stable wrapper around both
 * states (see api-keys-manager.tsx's `KeyRow` for the pattern — a ref on
 * that wrapper, focused from inside `onCancel`/`onConfirm`).
 */
export function InlineConfirm({
  message,
  confirmLabel,
  busyLabel,
  busy = false,
  onConfirm,
  onCancel,
  describedBy,
  className = '',
}: {
  message: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  describedBy?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-end gap-2 rounded-lg border border-line bg-surface-sunken p-3 sm:w-64 ${className}`}
    >
      <p className="text-xs leading-relaxed text-muted">{message}</p>
      <div className="flex gap-2">
        <Button autoFocus variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" disabled={busy} aria-describedby={describedBy} onClick={onConfirm}>
          {busy ? busyLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
