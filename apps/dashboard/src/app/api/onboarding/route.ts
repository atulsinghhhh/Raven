import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

export async function GET() {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    return NextResponse.json(await ravenApi.getOnboarding(token));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    // Forwarded as-is: the Control API's DTO is the validator of record.
    const body = await request.json();
    return NextResponse.json(await ravenApi.updateOnboarding(token, body));
  } catch (error) {
    return handleApiError(error);
  }
}
