import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import { CliAuthConfirm } from './cli-auth-confirm';

export const metadata: Metadata = {
  title: 'Authorize Livqeno CLI — Livqeno',
};

// Browser side of `raven login`. No new credential type here, no separate
// auth system: just relays your existing dashboard session to the CLI
// process waiting on localhost, once you approve it.
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; state?: string }>;
}) {
  const { port, state } = await searchParams;

  if (!port || !state) {
    return (
      <CliAuthFrame>
        <ErrorState
          title="Missing or invalid CLI login request"
          description={
            <>
              This page was opened without the parameters the CLI hands over. Run{' '}
              <code className="font-mono text-xs">raven login</code> again from your terminal.
            </>
          }
        />
      </CliAuthFrame>
    );
  }

  const token = await getSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/cli-auth?port=${port}&state=${state}`)}`);
  }

  const email = decodeSessionEmail(token) ?? 'your account';

  return (
    <CliAuthFrame>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-fg">Authorize Livqeno CLI</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A terminal on this computer is requesting access as <strong className="font-medium text-fg">{email}</strong>,
          via local port <code className="font-mono text-xs text-fg">{port}</code>. Only approve this if you just ran{' '}
          <code className="font-mono text-xs text-fg">raven login</code> yourself.
        </p>
      </div>

      <Card className="mt-7 shadow-raven-sm">
        <dl className="grid grid-cols-1 gap-3 rounded-md border border-line bg-surface-sunken p-3.5 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="font-medium text-muted">Account</dt>
            <dd className="mt-1 truncate text-fg" title={email}>
              {email}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-muted">Local callback</dt>
            <dd className="mt-1 truncate font-mono text-fg">127.0.0.1:{port}</dd>
          </div>
        </dl>

        {/* The consequence, stated before the button rather than after it.
            This hands the CLI a working session token — it is not a
            read-only or scoped grant. */}
        <div className="mt-4 rounded-md border border-warning-line bg-warning-subtle p-3.5">
          <p className="text-xs font-medium text-warning-text">This grants full account access</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-warning-text">
            <li>
              The CLI receives a session token and can act as <strong className="font-medium">{email}</strong> — read and
              create projects, and issue or revoke API keys.
            </li>
            <li>
              The token is sent only to <span className="font-mono">127.0.0.1:{port}</span> on this machine, never to a
              remote host.
            </li>
            <li>If you did not start this login, close this tab instead of approving.</li>
          </ul>
        </div>

        <div className="mt-5">
          <CliAuthConfirm port={port} state={state} />
        </div>
      </Card>
    </CliAuthFrame>
  );
}

/** Shared chrome with the sign-in surfaces, so the hand-off doesn't look
 *  like a different product mid-flow. */
function CliAuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Livqeno</span>
          </span>
        </div>
        <div className="mt-7">{children}</div>
      </div>
    </main>
  );
}
