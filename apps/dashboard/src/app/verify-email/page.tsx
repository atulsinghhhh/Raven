import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifyEmailPanel } from './verify-email-panel';

export const metadata: Metadata = {
  title: 'Confirm your email — Livqeno',
  // A verification link is single-use: an indexer following it would burn
  // the token before the recipient ever clicked.
  robots: { index: false, follow: false },
};

/**
 * The landing page for the link in a verification email. The API route it
 * calls is `POST /v1/auth/verify-email`, via this app's own BFF — the
 * browser never talks to the Control API directly.
 */
export default function VerifyEmailPage() {
  return (
    <AuthShell title="Confirm your email">
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <VerifyEmailPanel />
      </Suspense>
    </AuthShell>
  );
}
