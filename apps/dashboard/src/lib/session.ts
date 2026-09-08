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
