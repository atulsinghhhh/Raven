import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/app/login/login-form';
import type { AuthResponse } from '@/lib/api-client';

const push = jest.fn();
const refresh = jest.fn();
let nextParam: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => ({ get: (key: string) => (key === 'next' ? nextParam : null) }),
}));

function authResponse(overrides: Partial<AuthResponse> = {}): AuthResponse {
  return {
    accessToken: 'jwt.does.not.matter',
    expiresIn: '12h',
    user: { id: 'user_1', email: 'dev@example.com', name: null, isPlatformAdmin: false },
    onboarding: { completed: true, step: 7 },
    ...overrides,
  };
}

async function submit() {
  await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginForm — post-login redirect target', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    nextParam = null;
  });

  it('redirects to a same-origin `next` path after a successful login', async () => {
    nextParam = '/dashboard/projects/proj_1/settings';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => authResponse() });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/dashboard/projects/proj_1/settings');
  });

  it('falls back to /dashboard instead of following an attacker-supplied absolute `next` URL', async () => {
    // The classic post-login open-redirect payload: a link like
    // /login?next=https://evil.example/phish sent to a real user, banking on
    // "it's the real login domain" passing casual inspection.
    nextParam = 'https://evil.example/phish';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => authResponse() });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('evil.example'));
  });

  it('falls back to /dashboard instead of following a protocol-relative `next` URL', async () => {
    nextParam = '//evil.example';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => authResponse() });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('a Super Admin Portal account with a malicious `next` still falls back to its own safe default, never the attacker URL', async () => {
    nextParam = 'https://evil.example';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => authResponse({ user: { id: 'user_1', email: 'ops@example.com', name: null, isPlatformAdmin: true } }),
    });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/super-admin');
  });
});

describe('LoginForm — onboarding, failure, and loading behavior', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    nextParam = null;
  });

  it('sends an account with incomplete onboarding to /onboarding, overriding any `next`', async () => {
    nextParam = '/dashboard/projects/proj_1/settings';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => authResponse({ onboarding: { completed: false, step: 2 } }),
    });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/onboarding');
  });

  it('a Super Admin Portal account is exempt from onboarding even when incomplete', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        authResponse({
          user: { id: 'user_1', email: 'ops@example.com', name: null, isPlatformAdmin: true },
          onboarding: { completed: false, step: 0 },
        }),
    });

    render(<LoginForm />);
    await submit();

    expect(push).toHaveBeenCalledWith('/super-admin');
  });

  it('shows the server-provided error and does not navigate when the API rejects the credentials', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' }),
    });

    render(<LoginForm />);
    await submit();

    expect(screen.getByText('Incorrect email or password')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows a generic unreachable-server message and does not navigate when fetch itself throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    render(<LoginForm />);
    await submit();

    expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('disables the submit button and shows the busy state while the request is in flight, and clears it after', async () => {
    let resolveFetch!: (value: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    render(<LoginForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'dev@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    const button = screen.getByRole('button', { name: /sign in/i });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('Signing in…');

    resolveFetch({ ok: true, status: 200, json: async () => authResponse() });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
