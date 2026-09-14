'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { Field } from '@/components/ui/field';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Login failed');
        return;
      }

      // Incomplete onboarding wins over `next`: an account that never
      // finished first-run setup gets sent back into it, and the flow ends
      // at the dashboard anyway. A Super Admin Portal account is exempt —
      // "create your first project" has nothing to do with an internal ops
      // account, and forcing one through it would strand a `next=/super-admin`
      // redirect at a screen it was never meant to complete.
      if (!payload.user?.isPlatformAdmin && payload.onboarding && !payload.onboarding.completed) {
        router.push('/onboarding');
      } else {
        // `next` carries the page the user was trying to reach — including
        // the CLI authorisation hand-off — so an explicit one always wins.
        // Absent that, a Super Admin Portal account lands in the console
        // it actually uses: it has no projects, so the developer dashboard
        // is a dead end for this account, not a sensible default.
        const fallback = payload.user?.isPlatformAdmin ? '/super-admin' : '/dashboard';
        router.push(searchParams.get('next') ?? fallback);
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* ErrorState carries role="alert", so a failed sign-in is announced
          without moving focus away from the field being corrected. */}
      {error && <ErrorState title="Could not sign in" description={error} />}

      <Field
        id="email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <Button type="submit" loading={submitting} className="mt-1 w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
