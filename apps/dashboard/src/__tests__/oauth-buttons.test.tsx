import { render, screen } from '@testing-library/react';
import { AuthDivider, OAuthButtons } from '@/components/auth/oauth-buttons';
import { AuthApiUnreachable, AuthError } from '@/components/auth/auth-error';
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

  // The icons had no coverage at all, which is how "the GitHub and Google
  // icons don't show" could be reported without a test going red. They
  // turned out to render fine — the buttons were absent entirely, because
  // the API was down (see AuthApiUnreachable). These pin the icons anyway:
  // a provider button with no mark on it is a broken button.
  describe('provider icons', () => {
    it('renders a mark inside each provider button', () => {
      const { container } = render(<OAuthButtons providers={{ github: true, google: true }} />);

      for (const name of [/continue with github/i, /continue with google/i]) {
        const button = screen.getByRole('link', { name });
        const svg = button.querySelector('svg');
        expect(svg).not.toBeNull();
        // Sized, not a zero-by-zero box that renders as nothing.
        expect(svg).toHaveClass('size-4');
        // Decorative: the accessible name comes from the label text, so a
        // screen reader must not also announce the mark.
        expect(svg).toHaveAttribute('aria-hidden');
      }

      expect(container.querySelectorAll('svg')).toHaveLength(2);
    });

    it("draws GitHub's mark in the button's own colour", () => {
      // Monochrome via currentColor, per GitHub's brand guidance — and it
      // is what keeps the mark visible in both themes.
      render(<OAuthButtons providers={{ github: true, google: false }} />);

      const svg = screen.getByRole('link', { name: /github/i }).querySelector('svg')!;
      expect(svg).toHaveAttribute('fill', 'currentColor');
      expect(svg.querySelector('path')).toHaveAttribute('d');
    });

    it("draws Google's four-colour G with fixed brand colours", () => {
      // Google's guidance forbids recolouring the G, so these must not
      // inherit currentColor the way GitHub's mark does.
      render(<OAuthButtons providers={{ github: false, google: true }} />);

      const svg = screen.getByRole('link', { name: /google/i }).querySelector('svg')!;
      const fills = [...svg.querySelectorAll('path')].map((path) => path.getAttribute('fill'));

      expect(fills).toEqual(['#4285F4', '#34A853', '#FBBC05', '#EA4335']);
      expect(svg).not.toHaveAttribute('fill', 'currentColor');
    });

    it('renders only the icon for the configured provider', () => {
      const { container } = render(<OAuthButtons providers={{ github: false, google: true }} />);
      expect(container.querySelectorAll('svg')).toHaveLength(1);
    });
  });

  it('divider is decorative only', () => {
    const { container } = render(<AuthDivider />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden');
  });
});

describe('AuthApiUnreachable', () => {
  it('says the API could not be reached, rather than leaving the page silently short of buttons', () => {
    render(<AuthApiUnreachable />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/can't reach the livqeno api/i);
    expect(alert).toHaveTextContent(/some may be missing from this page/i);
  });

  it('warns that the email form will not work either', () => {
    // Sign-in needs the same API, so the form that is still on screen
    // cannot submit. Better to say so than to let someone type a password
    // into it.
    render(<AuthApiUnreachable />);
    expect(screen.getByRole('alert')).toHaveTextContent(/signing in will not work until the api is back/i);
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
