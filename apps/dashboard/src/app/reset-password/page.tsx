import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
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
    <AuthShell title="Choose a new password">
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
