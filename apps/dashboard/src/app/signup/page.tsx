import type { Metadata } from 'next';
import { AuthError } from '@/components/auth/auth-error';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthDivider, OAuthButtons } from '@/components/auth/oauth-buttons';
import { ravenApi } from '@/lib/api-client';
import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Create account — Raven',
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const providers = await ravenApi.oauthProviders().catch(() => ({ github: false, google: false }));
  const hasOAuth = providers.github || providers.google;

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
      <OAuthButtons providers={providers} />
      {hasOAuth && <AuthDivider label="or sign up with email" />}
      <SignupForm />
    </AuthShell>
  );
}
