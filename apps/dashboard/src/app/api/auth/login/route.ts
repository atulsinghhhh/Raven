import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError } from '@/lib/route-helpers';
import {
  ONBOARDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  onboardingCookieOptions,
  sessionCookieOptions,
} from '@/lib/session';

export async function POST(request: NextRequest) {
  const { email, password } = await request.json().catch(() => ({}));

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'email and password are required' }, { status: 400 });
  }

  try {
    const auth = await ravenApi.login(email, password);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, auth.accessToken, sessionCookieOptions());
    // Routing hint for proxy.ts. An API too old to report onboarding is
    // treated as complete — never strand an existing deployment's users in
    // a flow their API can't finish. A Super Admin Portal account is
    // treated as complete unconditionally: "create your first project"
    // onboarding is a developer-dashboard concept, and an ops-only account
    // has no reason to ever pass through it.
    const onboardingComplete = auth.user.isPlatformAdmin || (auth.onboarding?.completed ?? true);
    store.set(ONBOARDING_COOKIE_NAME, onboardingComplete ? 'complete' : 'pending', onboardingCookieOptions());
    return NextResponse.json({ user: auth.user, onboarding: auth.onboarding ?? { completed: true, step: 7 } });
  } catch (error) {
    return handleApiError(error);
  }
}
