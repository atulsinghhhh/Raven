'use client';

import type { DeveloperDetail } from '@/lib/super-admin/developers';

/**
 * Plain HTML forms posting to Next.js Route Handlers
 * (`app/api/super-admin/developers/[id]/{suspend,unsuspend}/route.ts`) —
 * no client JS required for the mutation itself, works with the browser's
 * own POST-then-redirect. The only reason this is a client component at
 * all is the confirm() guard below: suspending an account is a one-click,
 * irreversible-feeling action with no other confirmation step anywhere in
 * this flow, unlike every comparable destructive action elsewhere in the
 * console (revoking an API key, revoking platform access), which all
 * restate the consequence before committing.
 *
 * Hidden entirely for a `SUPPORT`/`READ_ONLY` admin: the API would 403 the
 * request anyway (`PlatformRoleGuard` re-checks server-side regardless of
 * what this page renders), so this is UX only, not the security boundary.
 */
export function SuspendUnsuspendForm({
  id,
  status,
  canMutate,
}: {
  id: string;
  status: DeveloperDetail['status'];
  canMutate: boolean;
}) {
  if (!canMutate) return null;

  if (status === 'ACTIVE') {
    return (
      <form
        action={`/api/super-admin/developers/${id}/suspend`}
        method="POST"
        className="flex items-center gap-2"
        onSubmit={(e) => {
          if (!window.confirm('Suspend this account? They lose access to the dashboard and API immediately.')) {
            e.preventDefault();
          }
        }}
      >
        <input
          type="text"
          name="reason"
          required
          aria-label="Reason for suspension"
          placeholder="Reason for suspension"
          className="h-9 w-56 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-line-strong"
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md bg-danger px-3.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
        >
          Suspend account
        </button>
      </form>
    );
  }

  return (
    <form
      action={`/api/super-admin/developers/${id}/unsuspend`}
      method="POST"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        if (!window.confirm('Restore this account? They regain access to the dashboard and API immediately.')) {
          e.preventDefault();
        }
      }}
    >
      <input
        type="text"
        name="reason"
        required
        aria-label="Reason for unsuspending"
        placeholder="Reason for unsuspending"
        className="h-9 w-56 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-line-strong"
      />
      <button
        type="submit"
        className="glow-accent inline-flex h-9 items-center justify-center rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
      >
        Unsuspend account
      </button>
    </form>
  );
}
