import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; product: string }>;
}

// Validated here only for the type cast — an unknown value still reaches
// the Control API, which rejects it (parseProductParam) with a real error.
type Product = 'rtc' | 'chat' | 'live-streaming';

export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, product } = await params;

  // Forwarded as-is: the Control API's DTO is the validator of record. A malformed
  // body still needs to reach it as `{}` rather than throwing here, or the failure
  // gets mislabeled as "Control API unreachable" by the catch below.
  const body = await request.json().catch(() => ({}));

  try {
    return NextResponse.json(await ravenApi.selectIntegration(token, projectId, product as Product, body));
  } catch (error) {
    return handleApiError(error);
  }
}
