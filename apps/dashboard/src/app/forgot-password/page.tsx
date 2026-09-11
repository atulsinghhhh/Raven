import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset your password — Livqeno',
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the address you signed up with and we’ll send you a link."
      footer={
        <p>
          Remembered it?{' '}
          <a href="/login" className="font-medium text-accent-text hover:underline">
            Sign in
          </a>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
