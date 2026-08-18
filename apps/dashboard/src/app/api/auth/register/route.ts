import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ravenApi } from '@/lib/api-client';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/session';

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'email and password are required' }, { status: 400 });
  }

  try {
    const auth = await ravenApi.register(email, password);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, auth.accessToken, sessionCookieOptions());
    return NextResponse.json({ user: auth.user });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ code: 'NETWORK_ERROR', message: 'Could not reach the Control API' }, { status: 502 });
  }
}
