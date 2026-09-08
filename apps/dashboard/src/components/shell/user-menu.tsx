'use client';

import { useRouter } from 'next/navigation';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { IconExternal, IconFolder, IconGitHub, IconSettings, IconSignOut } from '@/components/ui/icons';
import { DOCS_URL, GITHUB_URL } from '@/lib/nav';

function initials(name: string | null | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split('@')[0];
  if (!source) return '?';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/**
 * The profile menu in the top-right of both shells. The header block shows
 * who is signed in (name when the account has one, always the email);
 * everything below it is navigation, with sign-out kept visually apart.
 */
export function UserMenu({ email, name }: { email?: string; name?: string | null }) {
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
      menuClassName="min-w-56"
      trigger={({ open }) => (
        <span
          className={`flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
            open ? 'border-accent bg-accent-subtle text-accent-text' : 'border-line bg-surface-raised text-muted'
          }`}
        >
          {initials(name, email)}
        </span>
      )}
    >
      {(name || email) && (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-xs font-semibold text-muted">
            {initials(name, email)}
          </span>
          <span className="min-w-0">
            {name && <span className="block truncate text-sm font-medium text-fg">{name}</span>}
            {email && <span className="block truncate text-xs text-muted">{email}</span>}
          </span>
        </div>
      )}
      {(name || email) && <MenuSeparator />}
      <MenuItem href="/dashboard/settings" icon={<IconSettings className="size-3.5" />}>
        Profile &amp; settings
      </MenuItem>
      <MenuItem href="/dashboard/projects" icon={<IconFolder className="size-3.5" />}>
        All projects
      </MenuItem>
      <MenuSeparator />
      <MenuItem href={DOCS_URL} icon={<IconExternal className="size-3.5" />}>
        Documentation
      </MenuItem>
      <MenuItem href={GITHUB_URL} icon={<IconGitHub className="size-3.5" />}>
        GitHub
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={signOut} danger icon={<IconSignOut className="size-3.5" />}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
