import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/console/console-shell';
import { getSessionToken } from '@/lib/session';
import { ApiError, superAdminApi } from '@/lib/super-admin-client';

/**
 * The Super Admin Portal's real auth gate. `proxy.ts` redirects an
 * unauthenticated request before this ever runs, but that's UX only — this
 * is the check that matters, and it does not stop at "is there a session."
 *
 * `superAdminApi.me()` hits `GET /v1/super-admin/me`, which sits behind
 * `JwtAuthGuard` + `PlatformRoleGuard` on the API. A normal developer has a
 * perfectly valid session cookie and gets a 403 here — this layout sends
 * them back to their own dashboard rather than showing an error page,
 * because "you're logged in, just not into this" is the accurate story,
 * not a broken page.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin');

  const admin = await fetchPlatformAdmin(token);

  return <ConsoleShell admin={admin}>{children}</ConsoleShell>;
}

async function fetchPlatformAdmin(token: string) {
  try {
    return await superAdminApi.me(token);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect('/dashboard');
    }
    throw err;
  }
}
