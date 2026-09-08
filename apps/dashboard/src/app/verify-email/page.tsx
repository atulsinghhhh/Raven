import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifyEmailPanel } from './verify-email-panel';

export const metadata: Metadata = {
  title: 'Confirm your email — Raven',
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
        </header>

        <Card className="mt-7 shadow-raven-sm">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <VerifyEmailPanel />
          </Suspense>
        </Card>
      </div>
    </main>
  );
}
