import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset your password — Raven',
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-fg">Reset your password</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Enter the address you signed up with and we’ll send you a link.
          </p>
        </header>

        <Card className="mt-7 shadow-raven-sm">
          <ForgotPasswordForm />
        </Card>

        <p className="mt-5 text-center text-sm text-muted">
          Remembered it?{' '}
          <a href="/login" className="font-medium text-accent-text hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
