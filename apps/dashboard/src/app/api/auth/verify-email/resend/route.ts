import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

/** Session-only: the API takes the address from the JWT, never from a body. */
export async function POST() {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    return NextResponse.json(await ravenApi.resendVerificationEmail(token), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
