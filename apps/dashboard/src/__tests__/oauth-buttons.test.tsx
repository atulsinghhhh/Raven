import { render, screen } from '@testing-library/react';
import { AuthDivider, OAuthButtons } from '@/components/auth/oauth-buttons';
import { AuthError } from '@/components/auth/auth-error';
import { safeInternalPath } from '@/lib/safe-path';

describe('OAuthButtons', () => {
  it('renders a button per configured provider, pointing at the server-side start route', () => {
    render(<OAuthButtons providers={{ github: true, google: true }} />);
    expect(screen.getByRole('link', { name: /continue with github/i })).toHaveAttribute(
      'href',
      '/api/auth/oauth/github/start',
    );
    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/api/auth/oauth/google/start',
    );
  });

  it('renders nothing when no provider is configured — a button that cannot complete is worse than none', () => {
    const { container } = render(<OAuthButtons providers={{ github: false, google: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('threads the next path through to the start route', () => {
    render(<OAuthButtons providers={{ github: true, google: false }} next="/dashboard/projects/p1" />);
    expect(screen.getByRole('link', { name: /continue with github/i })).toHaveAttribute(
      'href',
      '/api/auth/oauth/github/start?next=%2Fdashboard%2Fprojects%2Fp1',
    );
    expect(screen.queryByRole('link', { name: /google/i })).not.toBeInTheDocument();
  });

  it('divider is decorative only', () => {
    const { container } = render(<AuthDivider />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden');
  });
});

describe('AuthError', () => {
  it('maps a known reason code to a human sentence', () => {
    render(<AuthError code="oauth_state_mismatch" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/expired or was opened in a different browser/i);
  });

  it('never echoes an unknown code back into the page', () => {
    render(<AuthError code="<img src=x onerror=alert(1)>" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be completed/i);
    expect(alert.textContent).not.toContain('onerror');
  });

  it('renders nothing without a code', () => {
    const { container } = render(<AuthError />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('safeInternalPath (open-redirect protection)', () => {
  it('accepts a plain absolute path', () => {
    expect(safeInternalPath('/dashboard/projects/p1')).toBe('/dashboard/projects/p1');
  });

  it.each(['//evil.example', 'https://evil.example', 'dashboard', '/back\\slash', '', null, undefined])(
    'discards %p',
    (value) => {
      expect(safeInternalPath(value as string | null | undefined)).toBeUndefined();
    },
  );
});
