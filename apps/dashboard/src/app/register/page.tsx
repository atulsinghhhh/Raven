import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { RavenMark } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: 'Create an account — Raven',
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-fg">Create your Raven account</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Real-time communication infrastructure — rooms, connections, observability, and SDKs.
          </p>
        </header>

        <Card className="mt-7 shadow-raven-sm">
          <RegisterForm />
        </Card>

        <p className="mt-5 text-center text-sm text-muted">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-accent-text hover:underline">
            Sign in
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
