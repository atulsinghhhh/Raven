import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from './lib/session';

/**
 * A UX redirect only — NOT the authorization boundary. Every dashboard
 * page still calls the Control API with this session's JWT, and the API
 * itself re-checks authentication (JwtAuthGuard) and per-resource
 * ownership on every request (see docs/dashboard.md#authorization).
 * Someone bypassing this middleware entirely would just get a 401/404
 * from the API, never someone else's data.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
