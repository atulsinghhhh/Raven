import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { SESSION_COOKIE_NAME } from '@/lib/session';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    // Best-effort — cookie gets cleared regardless. If the blocklist call
    // fails, we still don't want the user stuck looking logged in.
    await ravenApi.logout(token).catch(() => undefined);
  }

  store.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
