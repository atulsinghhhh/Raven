import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, OAuthProvider, ravenApi } from '@/lib/api-client';
import {
  OAUTH_STATE_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  onboardingCookieOptions,
  sessionCookieOptions,
} from '@/lib/session';
import { safeInternalPath } from '@/lib/safe-path';

/**
 * Where the provider sends the browser back. This is the URL registered as
 * the OAuth app's callback (GITHUB_CALLBACK_URL / GOOGLE_CALLBACK_URL).
 *
 * Everything that can go wrong here ends as a redirect to /login?error=…,
 * never an error page: the person is mid-sign-in in a browser, and a JSON
 * body or a 500 would strand them. Errors carry a reason code, never
 * provider details.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const loginError = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));

  if (provider !== 'github' && provider !== 'google') {
    return loginError('oauth_unknown_provider');
  }

  const store = await cookies();
  const stateCookie = store.get(OAUTH_STATE_COOKIE_NAME)?.value;
  // Single-use on this side too: whatever happens next, this authorization
  // attempt is spent. The path must match the one the cookie was set with,
  // or the delete silently misses it.
  store.delete({ name: OAUTH_STATE_COOKIE_NAME, path: '/api/auth/oauth' });

  const params = request.nextUrl.searchParams;

  // The person clicked "cancel" at the provider. Not an error worth a red
  // banner — send them back to the login screen they left.
  if (params.get('error') === 'access_denied') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (params.get('error')) {
    return loginError('oauth_provider_error');
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code || !returnedState) {
    return loginError('oauth_invalid_callback');
  }

  // CSRF check: the state must match the cookie set when *this browser*
  // started the flow. The Control API separately enforces single-use.
  const [expectedState, nextPath = ''] = stateCookie?.split('|') ?? [];
  if (!expectedState || expectedState !== returnedState) {
    return loginError('oauth_state_mismatch');
  }

  try {
    const auth = await ravenApi.oauthExchange(provider as OAuthProvider, code, returnedState);

    store.set(SESSION_COOKIE_NAME, auth.accessToken, sessionCookieOptions());
    const onboardingComplete = auth.onboarding?.completed ?? true;
    store.set(ONBOARDING_COOKIE_NAME, onboardingComplete ? 'complete' : 'pending', onboardingCookieOptions());

    const destination = onboardingComplete ? (safeInternalPath(nextPath) ?? '/dashboard') : '/onboarding';
    return NextResponse.redirect(new URL(destination, request.url));
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'RAVEN_OAUTH_EMAIL_UNAVAILABLE') return loginError('oauth_no_email');
      if (error.code === 'RAVEN_OAUTH_EMAIL_UNVERIFIED') return loginError('oauth_email_unverified');
      if (error.status === 501) return loginError('oauth_not_configured');
      return loginError('oauth_failed');
    }
    return loginError('oauth_failed');
  }
}
