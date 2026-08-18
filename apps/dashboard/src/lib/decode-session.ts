/**
 * Decodes (never verifies) the session JWT's payload for display purposes
 * only (e.g. showing the signed-in email in the nav) — the same
 * decode-only pattern established in the SDK (packages/sdk/src/config.ts).
 * The Control API is the only thing that ever actually verifies this
 * token; every real data request is authorized there, not here.
 */
export function decodeSessionEmail(token: string): string | undefined {
  try {
    const [, payloadB64] = token.split('.');
    const json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return typeof json?.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}
