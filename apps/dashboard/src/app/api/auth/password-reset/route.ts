import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError } from '@/lib/route-helpers';

/**
 * Forwards a reset request. The API answers identically for known and
 * unknown addresses, and this handler must not add a distinction the API
 * deliberately withheld — so it passes the response straight through.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (typeof body?.email !== 'string' || body.email.length === 0) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'email is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await ravenApi.requestPasswordReset(body.email), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
