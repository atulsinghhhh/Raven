import { NextResponse } from 'next/server';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';

/**
 * Hands the browser back its OWN existing session (from the httpOnly
 * cookie it can't read directly) so cli-auth-confirm.tsx can relay it to
 * a local CLI process. This is a same-origin, cookie-authenticated
 * response — it doesn't mint a new credential, it returns what the
 * cookie already grants. Only ever called from /cli-auth after explicit
 * user approval — see docs/cli.md#authentication.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Not signed in' }, { status: 401 });
  }

  const email = decodeSessionEmail(token);
  return NextResponse.json({ token, email });
}
