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
  const { email, password, name } = await request.json().catch(() => ({}));

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'email and password are required' }, { status: 400 });
  }

  try {
    const auth = await ravenApi.register(
      email,
      password,
      typeof name === 'string' && name.trim() ? name.trim() : undefined,
    );
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, auth.accessToken, sessionCookieOptions());
    const onboardingComplete = auth.onboarding?.completed ?? true;
    store.set(ONBOARDING_COOKIE_NAME, onboardingComplete ? 'complete' : 'pending', onboardingCookieOptions());
    return NextResponse.json({ user: auth.user, onboarding: auth.onboarding ?? { completed: true, step: 7 } });
  } catch (error) {
    return handleApiError(error);
  }
}
