import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Choose a new password — Raven',
  // The URL carries a live credential. Nothing should index it, and
  // nothing should send it onward as a referrer.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-fg">Choose a new password</h1>
        </header>

        <Card className="mt-7 shadow-raven-sm">
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <ResetPasswordForm />
          </Suspense>
        </Card>
      </div>
    </main>
  );
}
