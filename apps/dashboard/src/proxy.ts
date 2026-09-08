import { NextRequest, NextResponse } from 'next/server';
import { ONBOARDING_COOKIE_NAME, SESSION_COOKIE_NAME } from './lib/session';

// UX redirects, not the real auth check. Every dashboard page hits the
// Control API with the session JWT, and the API re-checks auth + ownership
// on every request; /onboarding and /dashboard both re-verify onboarding
// state server-side. Skip this middleware entirely and you get a 401/404 or
// an immediate server-side redirect — never someone else's data.
//
// Three rules, and they can't loop because each redirect lands on a path
// the other rules pass through:
//   no session            → /login?next=…
//   session, onboarding pending, on /dashboard   → /onboarding
//   session, onboarding complete, on /onboarding → /dashboard
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // The hint cookie is routing state, not authorization (see lib/session.ts).
  // A session from before the cookie existed has no hint: treat it as
  // complete, because those sessions belong to accounts the migration
  // backfilled as onboarded.
  const onboardingPending = request.cookies.get(ONBOARDING_COOKIE_NAME)?.value === 'pending';

  if (pathname.startsWith('/onboarding') && !onboardingPending) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname.startsWith('/dashboard') && onboardingPending) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/onboarding/:path*'],
};
