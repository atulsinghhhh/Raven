import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { ONBOARDING_COOKIE_NAME, SESSION_COOKIE_NAME, onboardingCookieOptions } from '@/lib/session';

/**
 * Re-issues the onboarding hint cookie from the authoritative API state,
 * then routes to wherever that state says the user belongs.
 *
 * This is the loop-breaker for a stale hint. proxy.ts routes on the cookie
 * alone (no API call per navigation), and the /onboarding page routes on
 * the real state — with a stale "pending" cookie those two would bounce a
 * completed account back and forth forever. The /onboarding page therefore
 * redirects *here* instead of straight to /dashboard: this handler is
 * outside proxy's matcher, may write cookies (a server component may not),
 * and leaves with cookie and state agreeing again.
 */
export async function GET(request: NextRequest) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const state = await ravenApi.getOnboarding(token);
    store.set(ONBOARDING_COOKIE_NAME, state.completed ? 'complete' : 'pending', onboardingCookieOptions());
    return NextResponse.redirect(new URL(state.completed ? '/dashboard' : '/onboarding', request.url));
  } catch {
    // Can't reach the API: assume complete, the default that never traps
    // anyone (the dashboard renders its own error state).
    store.set(ONBOARDING_COOKIE_NAME, 'complete', onboardingCookieOptions());
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
}
