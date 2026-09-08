import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';

/**
 * Auth gate only. The visual shell lives one level down, because the two
 * authenticated areas need different chrome: the project list has no
 * project to scope a sidebar to, everything under a project does.
 *
 * Belt and braces: proxy.ts already redirects when the cookie is
 * missing, but we can't assume every request went through it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  return <>{children}</>;
}
