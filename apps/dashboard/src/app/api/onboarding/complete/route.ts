import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { ONBOARDING_COOKIE_NAME, onboardingCookieOptions } from '@/lib/session';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

export async function POST() {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    const state = await ravenApi.completeOnboarding(token);
    // Flip the routing hint in the same response that completes onboarding,
    // or the very next navigation would bounce the user back to /onboarding.
    const store = await cookies();
    store.set(ONBOARDING_COOKIE_NAME, 'complete', onboardingCookieOptions());
    return NextResponse.json(state);
  } catch (error) {
    return handleApiError(error);
  }
}
