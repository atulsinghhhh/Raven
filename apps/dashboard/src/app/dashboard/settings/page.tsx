import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { Badge, deriveSystemStatus } from '@/components/ui/badge';
import { Card, SectionHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { IconGitHub } from '@/components/ui/icons';
import { formatDate, formatCount } from '@/lib/format';
import { ProfileForm } from './profile-form';
import { VerifyEmailNudge } from './verify-email-nudge';

export const metadata: Metadata = {
  title: 'Settings — Raven',
};

/**
 * Account settings. Everything shown is backed by a real endpoint —
 * there's no billing plan or org model yet, so there is no billing or org
 * section pretending otherwise. Project-scoped settings (members, danger
 * zone) live with the project.
 */
export default async function SettingsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');
  const email = decodeSessionEmail(token);

  const [profileResult, projectsResult, healthResult] = await Promise.allSettled([
    ravenApi.getMe(token),
    ravenApi.listProjects(token),
    ravenApi.getHealth(),
  ]);
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (profileResult.status === 'rejected') {
    if (profileResult.reason instanceof ApiError && profileResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load your account"
          description="The Control API is unreachable right now. Retry in a moment."
          retryHref="/dashboard/settings"
        />
      </AccountShell>
    );
  }

  const profile = profileResult.value;
  const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : [];
  const owned = projects.filter((p) => p.ownerId === profile.id);

  return (
    <AccountShell email={profile.email} name={profile.name} systemStatus={systemStatus}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <PageHeader title="Settings" description="Your account, how you sign in, and your workspace." />

        <section>
          <SectionHeader title="Profile" />
          <Card>
            <ProfileForm initialName={profile.name ?? ''} email={profile.email} />
          </Card>
        </section>

        <section>
          <SectionHeader title="Email" />
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-fg">{profile.email}</p>
                <p className="mt-0.5 text-xs text-muted">Member since {formatDate(profile.createdAt)}</p>
              </div>
              {profile.emailVerified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warning">Unverified</Badge>
              )}
            </div>
            {!profile.emailVerified && <VerifyEmailNudge />}
          </Card>
        </section>

        <section>
          <SectionHeader
            title="Authentication"
            subtitle="How this account signs in. Sessions expire after 12 hours either way."
          />
          <Card padded={false}>
            <ul className="divide-y divide-line">
              <li className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="text-sm text-fg">Password</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {profile.hasPassword
                      ? 'Set. Change it any time via a reset link.'
                      : 'Not set — this account signs in through a provider below.'}
                  </p>
                </div>
                <Link href="/forgot-password" className="shrink-0 text-xs font-medium text-accent-text hover:underline">
                  {profile.hasPassword ? 'Change password' : 'Set a password'}
                </Link>
              </li>
              {profile.authAccounts.map((account) => (
                <li key={account.provider} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    {account.provider === 'GITHUB' ? (
                      <IconGitHub className="size-4 text-subtle" />
                    ) : (
                      <span aria-hidden className="font-mono text-sm text-subtle">
                        G
                      </span>
                    )}
                    <div>
                      <p className="text-sm text-fg">{account.provider === 'GITHUB' ? 'GitHub' : 'Google'}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {account.email ?? 'Connected'} · linked {formatDate(account.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge tone="success">Connected</Badge>
                </li>
              ))}
              {profile.authAccounts.length === 0 && (
                <li className="px-5 py-3.5">
                  <p className="text-sm text-muted">
                    No providers connected. Sign in with GitHub or Google using this email and it will link
                    automatically.
                  </p>
                </li>
              )}
            </ul>
          </Card>
        </section>

        <section>
          <SectionHeader title="Workspace" />
          <Card padded={false}>
            <ul className="divide-y divide-line">
              <li className="flex items-center justify-between px-5 py-3.5">
                <p className="text-sm text-fg">Projects</p>
                <p className="text-sm text-muted">
                  {formatCount(projects.length)} total · {formatCount(owned.length)} owned
                </p>
              </li>
              <li className="flex items-center justify-between px-5 py-3.5">
                <p className="text-sm text-fg">Team members</p>
                <Link href="/dashboard/projects" className="text-xs font-medium text-accent-text hover:underline">
                  Managed per project
                </Link>
              </li>
            </ul>
          </Card>
        </section>
      </div>
    </AccountShell>
  );
}
