import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from './lib/session';

// Just a UX redirect, not the real auth check. Every dashboard page hits the
// Control API with the session JWT, and the API re-checks auth + ownership on
// every request. Skip this middleware entirely and you just get a 401/404,
// not someone else's data.
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
