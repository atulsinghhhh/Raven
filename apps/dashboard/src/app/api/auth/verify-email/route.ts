import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError } from '@/lib/route-helpers';

/**
 * No session required — this is the link from the verification email, and
 * the person clicking it is in a mail client that may not carry the
 * dashboard's cookie. The single-use token in the body is the only
 * credential involved, and it never reaches the browser's JS beyond the
 * query string it arrived in.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (typeof body?.token !== 'string' || body.token.length === 0) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'token is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await ravenApi.verifyEmail(body.token));
  } catch (error) {
    return handleApiError(error);
  }
}
