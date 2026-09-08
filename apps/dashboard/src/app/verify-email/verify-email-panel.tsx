'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';

type Status = 'verifying' | 'verified' | 'failed' | 'missing-token';

export function VerifyEmailPanel() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'missing-token');
  const [message, setMessage] = useState<string>();
  // React 18 mounts effects twice in development. The token is single-use,
  // so a second POST would report the first one's success as a failure.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const payload = await res.json().catch(() => undefined);

        if (!res.ok) {
          setStatus('failed');
          setMessage(payload?.message ?? 'This link could not be confirmed.');
          return;
        }
        setStatus('verified');
      } catch {
        setStatus('failed');
        setMessage('Could not reach the server. Check your connection and try again.');
      }
    })();
  }, [token]);

  if (status === 'verifying') {
    return <p className="text-sm text-muted">Confirming your email address…</p>;
  }

  if (status === 'verified') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-fg">Email confirmed</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Your address is confirmed and your account is active.
          </p>
        </div>
        <ButtonLink href="/dashboard" variant="primary" className="w-full">
          Open the dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorState
        title={status === 'missing-token' ? 'No confirmation token' : 'Could not confirm this link'}
        description={
          status === 'missing-token'
            ? 'Open the link from your verification email — it carries the token this page needs.'
            : (message ??
              'The link may have expired or already been used. Sign in and request a new one.')
        }
      />
      <ButtonLink href="/login" className="w-full">
        Go to sign in
      </ButtonLink>
    </div>
  );
}
