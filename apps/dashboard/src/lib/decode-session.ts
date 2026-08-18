// Decodes the JWT payload for display only (e.g. showing the email in the
// nav) — doesn't verify the signature. The Control API is what actually
// verifies this token; nothing here should be trusted for authorization.
export function decodeSessionEmail(token: string): string | undefined {
  try {
    const [, payloadB64] = token.split('.');
    const json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return typeof json?.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}
