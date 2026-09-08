import { cookies } from 'next/headers';

// Session JWT lives only in an httpOnly cookie, never in localStorage or
// anything client-readable: an XSS bug here can't steal it. Everything that
// reads this cookie is server-only; no client component ever sees the token.
export const SESSION_COOKIE_NAME = 'raven_session';

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Roughly matches the API's JWT_EXPIRES_IN (12h): doesn't need to be
    // exact since the API's own token expiry is what actually enforces this.
    maxAge: 60 * 60 * 12,
  };
}

// ---------------------------------------------------------------------------
// Onboarding routing hint
// ---------------------------------------------------------------------------

// A routing *hint*, not an authorization boundary. proxy.ts reads it to
// decide between /onboarding and /dashboard without an API call per
// navigation; the onboarding and dashboard pages re-check the real state
// against the Control API. Tampering with it buys an immediate redirect
// back, nothing more — which is why it's fine that it's just a cookie.
export const ONBOARDING_COOKIE_NAME = 'raven_onboarding';

export type OnboardingHint = 'complete' | 'pending';

export async function getOnboardingHint(): Promise<OnboardingHint | undefined> {
  const store = await cookies();
  const value = store.get(ONBOARDING_COOKIE_NAME)?.value;
  return value === 'complete' || value === 'pending' ? value : undefined;
}

export function onboardingCookieOptions() {
  // Same lifetime as the session it describes.
  return sessionCookieOptions();
}

// ---------------------------------------------------------------------------
// OAuth state
// ---------------------------------------------------------------------------

// Pins an in-flight OAuth authorization to this browser. The Control API
// keeps its own single-use copy of the state in Redis (replay); this cookie
// is the CSRF half — the callback must arrive in the browser that started.
export const OAUTH_STATE_COOKIE_NAME = 'raven_oauth_state';

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // The provider redirect back to the callback is a top-level cross-site
    // navigation; 'lax' keeps the cookie on it while still blocking POSTs.
    sameSite: 'lax' as const,
    path: '/api/auth/oauth',
    // Matches the API's state TTL: one authorization round-trip.
    maxAge: 60 * 10,
  };
}
