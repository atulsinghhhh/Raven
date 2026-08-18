/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { SESSION_COOKIE_NAME } from '@/lib/session';

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

    // NextResponse.next() sets this internal header; absence of a redirect is the real assertion.
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
    // Any non-empty session cookie passes, even a garbage/expired one — real
    // authorization happens API-side (JwtAuthGuard + project ownership),
    // never here. See docs/dashboard.md#authorization.
    const request = new NextRequest('http://localhost:3000/dashboard/projects/someone-elses-project', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=garbage-not-a-real-jwt` },
    });
    const response = proxy(request);

    expect(response.status).not.toBe(307);
  });
});
