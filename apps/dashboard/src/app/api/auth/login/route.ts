import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ravenApi } from '@/lib/api-client';
import {
  ONBOARDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  onboardingCookieOptions,
  sessionCookieOptions,
} from '@/lib/session';

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'email and password are required' }, { status: 400 });
  }

  try {
    const auth = await ravenApi.login(email, password);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, auth.accessToken, sessionCookieOptions());
    // Routing hint for proxy.ts. An API too old to report onboarding is
    // treated as complete — never strand an existing deployment's users in
    // a flow their API can't finish.
    const onboardingComplete = auth.onboarding?.completed ?? true;
    store.set(ONBOARDING_COOKIE_NAME, onboardingComplete ? 'complete' : 'pending', onboardingCookieOptions());
    return NextResponse.json({ user: auth.user, onboarding: auth.onboarding ?? { completed: true, step: 7 } });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ code: 'NETWORK_ERROR', message: 'Could not reach the Control API' }, { status: 502 });
  }
}
