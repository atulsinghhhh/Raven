'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Status = 'idle' | 'authorizing' | 'done' | 'error';

export function CliAuthConfirm({ port, state }: { port: string; state: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>();

  async function handleApprove() {
    setStatus('authorizing');
    setError(undefined);

    try {
      // Same-origin request — the session cookie authorizes it server-side;
      // the token never touches this page's own storage, only this one
      // in-memory response used immediately below.
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
    return <p className="text-sm text-green-700 dark:text-green-400">You're signed in. You can close this tab and return to your terminal.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3">
        <Button onClick={handleApprove} disabled={status === 'authorizing'}>
          {status === 'authorizing' ? 'Authorizing…' : 'Authorize CLI'}
        </Button>
        <Button variant="secondary" onClick={() => window.close()} disabled={status === 'authorizing'}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
