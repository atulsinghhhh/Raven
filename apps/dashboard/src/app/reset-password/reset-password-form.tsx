'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

// Mirrors RegisterDto/ResetPasswordDto on the API. 72 is bcrypt's input
// limit, not a preference — the API rejects longer, so the form should say
// so rather than letting the round trip do it.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);

    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await res.json().catch(() => undefined);

      if (!res.ok) {
        setError(payload?.message ?? 'Could not change your password.');
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          title="No reset token"
          description="Open the link from your password-reset email — it carries the token this page needs."
        />
        <ButtonLink href="/forgot-password" className="w-full">
          Request a new link
        </ButtonLink>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-fg">Password changed</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Sign in with your new password. We’ve emailed you a confirmation that it changed.
          </p>
        </div>
        <ButtonLink href="/login" variant="primary" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorState title="Could not change your password" description={error} />}

      <Field
        id="password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        autoFocus
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        id="confirmation"
        name="confirmation"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
      />

      <Button type="submit" loading={submitting} className="mt-1 w-full">
        {submitting ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
