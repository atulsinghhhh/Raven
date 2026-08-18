import { cookies } from 'next/headers';

/**
 * The developer's session JWT lives only in an httpOnly cookie — never in
 * client-readable storage (localStorage, a non-httpOnly cookie, etc.), so
 * an XSS bug in this app can't exfiltrate it. Every read here is
 * server-only (Server Components, Route Handlers, middleware); no client
 * component ever sees the raw token.
 */
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
    // Matches the Control API's own JWT_EXPIRES_IN default (12h) closely
    // enough for a session cookie — the API's own token expiry is the
    // real enforcement point regardless of this value.
    maxAge: 60 * 60 * 12,
  };
}
