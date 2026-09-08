import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthError } from '@/components/auth/auth-error';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthDivider, OAuthButtons } from '@/components/auth/oauth-buttons';
import { Skeleton } from '@/components/ui/skeleton';
import { ravenApi } from '@/lib/api-client';
import { safeInternalPath } from '@/lib/safe-path';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in — Raven',
};

/**
 * Entry surface. Deliberately quiet: what Raven is, the sign-in methods
 * this deployment actually supports, and nothing else. OAuth buttons only
 * render for providers the Control API reports as configured.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeInternalPath(params.next);

  // An unreachable API mustn't take the whole login page down with it —
  // the email form still works the moment the API is back.
  const providers = await ravenApi.oauthProviders().catch(() => ({ github: false, google: false }));
  const hasOAuth = providers.github || providers.google;

  return (
    <AuthShell
      title="Sign in to Raven"
      subtitle="Realtime infrastructure for your applications."
      footer={
        <>
          <p>
            <a href="/forgot-password" className="font-medium text-accent-text hover:underline">
              Forgot your password?
            </a>
          </p>
          <p>
            No account?{' '}
            <a href="/signup" className="font-medium text-accent-text hover:underline">
              Create one
            </a>
          </p>
        </>
      }
    >
      <AuthError code={params.error} />
      <OAuthButtons providers={providers} next={next} />
      {hasOAuth && <AuthDivider label="or continue with email" />}
      <Suspense fallback={<FormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

/**
 * The form reads the `next` param, so it suspends on first render. This
 * fallback holds the exact height of the real form to stop the column from
 * resizing underneath the heading.
 */
function FormFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
