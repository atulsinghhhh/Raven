import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, OAuthProvider, ravenApi } from '@/lib/api-client';
import { OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions } from '@/lib/session';
import { safeInternalPath } from '@/lib/safe-path';

/**
 * "Continue with GitHub/Google" points the browser here. Server-side on
 * purpose: the Control API mints the single-use state and builds the
 * authorize URL (it owns the client id), we pin that state to this browser
 * in an httpOnly cookie, and only then does the browser leave for the
 * provider. No OAuth configuration exists in this app at all.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (provider !== 'github' && provider !== 'google') {
    return NextResponse.redirect(new URL('/login?error=oauth_unknown_provider', request.url));
  }

  try {
    const { authorizeUrl, state } = await ravenApi.oauthStart(provider as OAuthProvider);

    const store = await cookies();
    // `state|next` in one cookie: the callback needs both, and the `next`
    // path rides along instead of a second cookie. next is re-validated on
    // the way back out — never trusted just because we set it.
    const next = safeInternalPath(request.nextUrl.searchParams.get('next'));
    store.set(OAUTH_STATE_COOKIE_NAME, `${state}|${next ?? ''}`, oauthStateCookieOptions());

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const reason = error instanceof ApiError && error.status === 501 ? 'oauth_not_configured' : 'oauth_start_failed';
    return NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
  }
}
