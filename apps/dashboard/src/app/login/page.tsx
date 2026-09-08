import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { DOCS_URL } from '@/lib/nav';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in — Raven',
};

/**
 * Entry surface. Deliberately quiet: a mark, one sentence about what
 * Raven is, and the two fields the API actually needs. Nothing here is
 * offered that the auth API can't back: no SSO, no magic links.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-fg">Sign in to your console</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Real-time communication infrastructure — rooms, connections, observability, and SDKs.
          </p>
        </header>

        <Card className="mt-7 shadow-raven-sm">
          <Suspense fallback={<FormFallback />}>
            <LoginForm />
          </Suspense>
        </Card>

        <p className="mt-5 text-center text-sm text-muted">
          <a href="/forgot-password" className="font-medium text-accent-text hover:underline">
            Forgot your password?
          </a>
        </p>

        <p className="mt-2 text-center text-sm text-muted">
          No account?{' '}
          <a href="/register" className="font-medium text-accent-text hover:underline">
            Create one
          </a>
        </p>
      </div>

      <footer className="mt-10">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-subtle transition-colors hover:text-muted"
        >
          Documentation
        </a>
      </footer>
    </main>
  );
}

/**
 * The form reads the `next` param, so it suspends on first render. This
 * fallback holds the exact height of the real form to stop the card from
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
