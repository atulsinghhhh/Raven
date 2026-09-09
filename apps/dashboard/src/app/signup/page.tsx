import type { Metadata } from 'next';
import { AuthApiUnreachable, AuthError } from '@/components/auth/auth-error';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthDivider, OAuthButtons } from '@/components/auth/oauth-buttons';
import { ravenApi } from '@/lib/api-client';
import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Create account — Raven',
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  // `null` on failure, not false/false: "this deployment has no OAuth" and
  // "we could not ask" are different facts, and only one of them means the
  // missing buttons are intentional. Same reasoning as the login page.
  const providers = await ravenApi.oauthProviders().catch(() => null);
  const hasOAuth = Boolean(providers?.github || providers?.google);

  return (
    <AuthShell
      title="Create your Raven account"
      subtitle="Free to start. Build voice, video, chat, and live streaming."
      footer={
        <p>
          Already have an account?{' '}
          <a href="/login" className="font-medium text-accent-text hover:underline">
            Sign in
          </a>
        </p>
      }
    >
      <AuthError code={params.error} />
      {providers === null && <AuthApiUnreachable />}
      {providers && <OAuthButtons providers={providers} />}
      {hasOAuth && <AuthDivider label="or sign up with email" />}
      <SignupForm />
    </AuthShell>
  );
}
