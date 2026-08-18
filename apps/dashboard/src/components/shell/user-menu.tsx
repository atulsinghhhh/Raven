'use client';

import { useRouter } from 'next/navigation';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { IconExternal, IconFolder, IconSignOut } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

function initials(email: string | undefined): string {
  if (!email) return '?';
  const [local] = email.split('@');
  return (local?.slice(0, 2) ?? '?').toUpperCase();
}

export function UserMenu({ email }: { email?: string }) {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <Menu
      label="Account"
      align="end"
      className="w-auto"
      trigger={({ open }) => (
        <span
          className={`flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
            open ? 'border-accent bg-accent-subtle text-accent-text' : 'border-line bg-surface-raised text-muted'
          }`}
        >
          {initials(email)}
        </span>
      )}
    >
      {email && <MenuLabel>{email}</MenuLabel>}
      {email && <MenuSeparator />}
      <MenuItem href="/dashboard/projects" icon={<IconFolder className="size-3.5" />}>
        All projects
      </MenuItem>
      <MenuItem href={DOCS_URL} icon={<IconExternal className="size-3.5" />}>
        Documentation
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={signOut} danger icon={<IconSignOut className="size-3.5" />}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
