'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      // 429 is the only failure worth showing. Anything else — including
      // "no such account" — must look identical to success, or this form
      // becomes a way to test whether an address is registered.
      if (res.status === 429) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Too many attempts. Wait a minute and try again.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Check your inbox</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          If an account exists for that address, a password-reset link is on its way. The link is
          valid for a short time and can be used once.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorState title="Could not send the link" description={error} />}

      <Field
        id="email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoFocus
        placeholder="you@example.com"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Button type="submit" loading={submitting} className="mt-1 w-full">
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
