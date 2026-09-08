'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';

type Status = 'idle' | 'authorizing' | 'done' | 'error';

export function CliAuthConfirm({ port, state }: { port: string; state: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>();

  async function handleApprove() {
    setStatus('authorizing');
    setError(undefined);

    try {
      // Same-origin, cookie-authorized. The token stays in memory here and
      // never gets written to storage: used once, right below.
      const sessionRes = await fetch('/api/cli-auth/token', { method: 'POST' });
      if (!sessionRes.ok) throw new Error('Could not read your session — try signing in again.');
      const { token, email } = await sessionRes.json();

      const callbackRes = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, token, email }),
      });
      if (!callbackRes.ok) throw new Error('The CLI did not accept the login — is it still waiting?');

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  if (status === 'done') {
    return (
      <div
        role="status"
        className="flex gap-3 rounded-md border border-success-line bg-success-subtle p-3.5 text-success-text"
      >
        <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" fill="currentColor" aria-hidden="true">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.6 5.1l-4.2 4.4a.75.75 0 01-1.09 0L4.4 8.5a.75.75 0 011.09-1.03l1.37 1.44 3.65-3.84A.75.75 0 0111.6 6.1z" />
        </svg>
        <div className="min-w-0">
          <p className="text-sm font-medium">Raven CLI authorized</p>
          <p className="mt-1 text-sm leading-relaxed">
            You&apos;re signed in. You can close this tab and return to your terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* role="alert" comes from ErrorState — a failed hand-off has to be
          announced, not just rendered. */}
      {error && <ErrorState title="Could not authorize the CLI" description={error} />}

      {/* Cancel sits first so the approving click is a deliberate reach,
          not the one under the cursor by default. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => window.close()} disabled={status === 'authorizing'}>
          Cancel
        </Button>
        <Button onClick={handleApprove} loading={status === 'authorizing'}>
          {status === 'authorizing' ? 'Authorizing…' : 'Authorize CLI'}
        </Button>
      </div>
    </div>
  );
}
