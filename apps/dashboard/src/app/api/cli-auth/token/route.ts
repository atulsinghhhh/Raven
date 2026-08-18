import { NextResponse } from 'next/server';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';

// Hands the browser its own session token back (pulled from the httpOnly
// cookie it can't read directly) so cli-auth-confirm.tsx can forward it to the
// local CLI. Not minting anything new, just exposing what the cookie already
// grants. Only called from /cli-auth, after the user approves.
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Not signed in' }, { status: 401 });
  }

  const email = decodeSessionEmail(token);
  return NextResponse.json({ token, email });
}
