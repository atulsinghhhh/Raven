'use client';

/**
 * A BFF route forwards the Control API's real status (route-helpers.ts),
 * so a client-triggered mutation that comes back 401 means the session
 * cookie itself is stale/expired — not that this one action failed.
 * Every server-rendered page already redirects to /login on exactly this
 * status; a mutation needs the same outcome instead of a generic "could
 * not save" toast that leaves the user retrying against a session that
 * will never succeed again.
 *
 * Call this first in any client-side mutation's `!res.ok` branch. Returns
 * true (and redirects) when it handled the response, so the caller can
 * `return` without falling into its normal error-toast/inline-error path.
 */
export function handleSessionExpiry(response: Response): boolean {
  if (response.status !== 401) return false;
  // A hard navigation, not useRouter().push(): every other cached/prefetched
  // client-fetched project state in the tree is only valid for a session that
  // just proved itself invalid, so this needs the same full reload a
  // server-rendered page's redirect('/login') already produces — not a soft
  // route transition that could leave stale client state mounted underneath.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login');
  return true;
}
