/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { ONBOARDING_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/session';

describe('proxy (dashboard auth guard)', () => {
  it('redirects to /login when no session cookie is present', () => {
    const request = new NextRequest('http://localhost:3000/dashboard/projects');
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/dashboard/projects');
  });

  it('passes through (NextResponse.next) when a session cookie is present', () => {
    const request = new NextRequest('http://localhost:3000/dashboard/projects', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=some-jwt-value` },
    });
    const response = proxy(request);

    // NextResponse.next() doesn't set a location header: the real check is just "no redirect".
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).not.toBe(307);
  });

  it('preserves the originally-requested path in the redirect, for post-login redirect back', () => {
    const request = new NextRequest('http://localhost:3000/dashboard/projects/abc-123/settings');
    const response = proxy(request);

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('next')).toBe('/dashboard/projects/abc-123/settings');
  });

  it('this is a UX redirect only — it does not know or check WHICH project the cookie can access', () => {
    // Any non-empty cookie passes here, even garbage or expired ones: real
    // auth (JwtAuthGuard + ownership) happens API-side, not in this proxy.
    const request = new NextRequest('http://localhost:3000/dashboard/projects/someone-elses-project', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage-not-a-real-jwt` },
    });
    const response = proxy(request);

    expect(response.status).not.toBe(307);
  });
});

describe('proxy (onboarding routing)', () => {
  const withCookies = (url: string, cookies: string) => proxy(new NextRequest(url, { headers: { cookie: cookies } }));

  it('sends a signed-in account with pending onboarding from /dashboard to /onboarding', () => {
    const response = withCookies(
      'http://localhost:3000/dashboard',
      `${SESSION_COOKIE_NAME}=jwt; ${ONBOARDING_COOKIE_NAME}=pending`,
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('sends a completed account away from /onboarding to /dashboard', () => {
    const response = withCookies(
      'http://localhost:3000/onboarding',
      `${SESSION_COOKIE_NAME}=jwt; ${ONBOARDING_COOKIE_NAME}=complete`,
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard');
  });

  it('lets a pending account stay on /onboarding', () => {
    const response = withCookies(
      'http://localhost:3000/onboarding',
      `${SESSION_COOKIE_NAME}=jwt; ${ONBOARDING_COOKIE_NAME}=pending`,
    );
    expect(response.status).not.toBe(307);
  });

  it('treats a session with no onboarding hint as complete — pre-existing sessions were backfilled as onboarded', () => {
    const response = withCookies('http://localhost:3000/dashboard', `${SESSION_COOKIE_NAME}=jwt`);
    expect(response.status).not.toBe(307);
  });

  it('requires a session on /onboarding too', () => {
    const response = proxy(new NextRequest('http://localhost:3000/onboarding'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/onboarding');
  });

  it('cannot loop: each redirect lands on a path the other rule passes through', () => {
    // pending → /onboarding, and /onboarding with pending passes (asserted
    // above); complete → /dashboard, and /dashboard with complete passes:
    const response = withCookies(
      'http://localhost:3000/dashboard',
      `${SESSION_COOKIE_NAME}=jwt; ${ONBOARDING_COOKIE_NAME}=complete`,
    );
    expect(response.status).not.toBe(307);
  });
});
