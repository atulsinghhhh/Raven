'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

export function ProfileForm({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = name.trim() !== initialName.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    setSubmitting(true);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Could not save your profile.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorState title="Could not save" description={error} />}

      <Field
        id="profile-name"
        label="Display name"
        maxLength={120}
        placeholder="Ada Lovelace"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
      />
      <Field
        id="profile-email"
        label="Email"
        value={email}
        disabled
        readOnly
        hint="Email changes aren't supported yet — the address is the account key."
      />

      <div className="flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!dirty}>
          Save changes
        </Button>
        {/* aria-live so the confirmation is announced without stealing focus. */}
        <span aria-live="polite" className="text-xs text-success-text">
          {saved && 'Saved.'}
        </span>
      </div>
    </form>
  );
}
