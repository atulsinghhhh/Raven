import { RegisterForm } from './register-form';

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1 text-neutral-900 dark:text-neutral-100">Create your Raven account</h1>
        <p className="text-sm text-neutral-500 mb-6">Developer infrastructure for real-time communication.</p>
        <RegisterForm />
        <p className="text-sm text-neutral-500 mt-4">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-neutral-900 dark:text-neutral-100 underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
