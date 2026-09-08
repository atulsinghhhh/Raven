'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The unverified-email nudge. Wraps the existing resend endpoint, which is
 * cooldown-limited server-side — the message it returns already explains a
 * suppressed send, so it's shown verbatim.
 */
export function VerifyEmailNudge() {
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function resend() {
    setSubmitting(true);
    setMessage(undefined);
    try {
      const res = await fetch('/api/auth/verify-email/resend', { method: 'POST' });
      const payload = await res.json().catch(() => undefined);
      setMessage(payload?.message ?? (res.ok ? 'A new verification link is on its way.' : 'Could not send the email.'));
    } catch {
      setMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-xs leading-relaxed text-muted">
        Confirm your address to make sure password resets and account notices reach you.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={resend} loading={submitting}>
          Resend verification email
        </Button>
        <span aria-live="polite" className="text-xs text-muted">
          {message}
        </span>
      </div>
    </div>
  );
}
