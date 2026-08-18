import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { CliAuthConfirm } from './cli-auth-confirm';

/**
 * The browser side of `raven login` (packages/cli/src/commands/login.ts).
 * Reuses the dashboard's own existing session JWT verbatim — this page
 * does not mint a new kind of credential or run a separate auth system,
 * it only relays the *existing* session to a CLI process listening on
 * localhost after the user explicitly approves. See docs/cli.md#authentication.
 */
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; state?: string }>;
}) {
  const { port, state } = await searchParams;

  if (!port || !state) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-red-600 dark:text-red-400">
          Missing or invalid CLI login request. Run <code>raven login</code> again.
        </p>
      </main>
    );
  }

  const token = await getSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/cli-auth?port=${port}&state=${state}`)}`);
  }

  const email = decodeSessionEmail(token) ?? 'your account';

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold mb-2 text-neutral-900 dark:text-neutral-100">Authorize Raven CLI</h1>
        <p className="text-sm text-neutral-500 mb-6">
          A terminal on this computer is requesting access as <strong>{email}</strong>, via local port{' '}
          <code className="font-mono">{port}</code>. Only approve this if you just ran{' '}
          <code>raven login</code> yourself.
        </p>
        <CliAuthConfirm port={port} state={state} />
      </div>
    </main>
  );
}
