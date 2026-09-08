import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError } from '@/lib/route-helpers';

/**
 * Sets the new password. Nothing is written to a cookie here: a reset
 * deliberately does not sign the user in, so whoever holds the mailbox
 * still has to know the password they just chose.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (typeof body?.token !== 'string' || typeof body?.password !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'token and password are required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await ravenApi.resetPassword(body.token, body.password));
  } catch (error) {
    return handleApiError(error);
  }
}
