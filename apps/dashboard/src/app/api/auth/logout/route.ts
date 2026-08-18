import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { SESSION_COOKIE_NAME } from '@/lib/session';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    // Best-effort — the session cookie is cleared either way. A failed
    // server-side blocklist call must never trap the user in a logged-in
    // state from their own browser's perspective.
    await ravenApi.logout(token).catch(() => undefined);
  }

  store.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
