import { Suspense } from 'react';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1 text-neutral-900 dark:text-neutral-100">Sign in to Raven</h1>
        <p className="text-sm text-neutral-500 mb-6">Developer infrastructure for real-time communication.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="text-sm text-neutral-500 mt-4">
          No account?{' '}
          <a href="/register" className="font-medium text-neutral-900 dark:text-neutral-100 underline">
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}
