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

  // Forwarded as-is: the Control API's DTO is the validator of record. A malformed
  // body still needs to reach it as `{}` rather than throwing here, or the failure
  // gets mislabeled as "Control API unreachable" by the catch below.
  const body = await request.json().catch(() => ({}));

  try {
    return NextResponse.json(await ravenApi.updateOnboarding(token, body));
  } catch (error) {
    return handleApiError(error);
  }
}
