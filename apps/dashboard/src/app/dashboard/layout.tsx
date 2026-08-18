import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { SignOutButton } from './sign-out-button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionToken();
  // Belt-and-suspenders: middleware already redirects when the cookie is
  // absent, but a Server Component must never assume a request reached it
  // only via middleware (direct server-side navigations, tests, etc.).
  if (!token) redirect('/login');

  const email = decodeSessionEmail(token);

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <a href="/dashboard/projects" className="font-semibold text-neutral-900 dark:text-neutral-100">
            Raven
          </a>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-neutral-500">{email}</span>}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
