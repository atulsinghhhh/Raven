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

  try {
    // Forwarded as-is: the Control API's DTO is the validator of record.
    const body = await request.json();
    return NextResponse.json(await ravenApi.selectIntegration(token, projectId, product as Product, body));
  } catch (error) {
    return handleApiError(error);
  }
}
