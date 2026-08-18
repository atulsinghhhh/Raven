'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
    >
      Sign out
    </button>
  );
}
