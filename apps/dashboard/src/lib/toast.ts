/**
 * Transient action feedback ("API key created", "Unable to copy") —
 * distinct from the persistent notification center in
 * `components/shell/notifications-bell.tsx`, which is backed by real,
 * per-recipient database rows (Phase 5F) and stays available across a
 * session, reload, and device. A toast here is for "this one action you
 * just took finished" and disappears; it never becomes a
 * notification-center entry.
 *
 * Plain module state rather than React Context, on purpose: every caller
 * of `toast.success(...)` etc. is already inside a `'use client'` mutation
 * handler (form submit, button click) — none of them are Server
 * Components, so there's nothing to thread a Provider through. A Context
 * would only add a component every caller has to be wrapped in, for no
 * behavior Context actually provides here. `<Toaster />`
 * (components/ui/toaster.tsx) is the one place that reads this module's
 * state, via `subscribe`.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

// Longer for warning/error: those are the ones worth actually reading
// before they vanish, not just glancing at.
const DURATION_MS: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 6000,
};

let toasts: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function push(variant: ToastVariant, message: string): string {
  const id = `toast_${++nextId}`;
  toasts = [...toasts, { id, variant, message }];
  emit();
  timers.set(
    id,
    setTimeout(() => dismissToast(id), DURATION_MS[variant]),
  );
  return id;
}

/** Manual dismissal — the toast's own close button, or a test. */
export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** `<Toaster />`'s subscription. Returns the unsubscribe function. */
export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  warning: (message: string) => push('warning', message),
  info: (message: string) => push('info', message),
};
