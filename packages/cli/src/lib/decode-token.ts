/**
 * Reads claims out of a session JWT for display purposes only.
 *
 * The signature is never checked here, and nothing this returns is used
 * for an authorization decision — the Control API verifies the token on
 * every request. This exists so `raven login --token` and `raven whoami`
 * can show *which* account a token belongs to without a round trip.
 */
export interface DecodedSessionToken {
  email?: string;
  /** `exp` as milliseconds, matching Date, not the seconds JWTs use. */
  expiresAtMs?: number;
}

export function decodeSessionToken(token: string): DecodedSessionToken {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return {};

    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    return {
      email: typeof claims.email === 'string' ? claims.email : undefined,
      expiresAtMs: typeof claims.exp === 'number' ? claims.exp * 1000 : undefined,
    };
  } catch {
    // A token we can't parse still might be one the server accepts (it's
    // the server's opinion that counts), so this is not an error — the
    // caller just gets nothing to display.
    return {};
  }
}
