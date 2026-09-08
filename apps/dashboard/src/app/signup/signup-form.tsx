'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { Field } from '@/components/ui/field';

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(name.trim() ? { name: name.trim() } : {}) }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Registration failed');
        return;
      }

      // A brand-new account always has onboarding ahead of it; the fallback
      // covers an older API that doesn't report onboarding state.
      router.push(payload.onboarding && !payload.onboarding.completed ? '/onboarding' : '/dashboard');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* role="alert" lives on ErrorState, so a rejected registration is
          announced rather than only appearing above the fold. */}
      {error && <ErrorState title="Could not create account" description={error} />}

      <Field
        id="name"
        name="name"
        label="Name"
        type="text"
        autoComplete="name"
        placeholder="Ada Lovelace"
        maxLength={120}
        hint="Optional — shown in your workspace and to teammates."
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
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
      {/* The minimum is stated up front rather than only on rejection —
          the hint is wired to the input through aria-describedby by Field. */}
      <Field
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="At least 8 characters."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <Button type="submit" loading={submitting} className="mt-1 w-full">
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
