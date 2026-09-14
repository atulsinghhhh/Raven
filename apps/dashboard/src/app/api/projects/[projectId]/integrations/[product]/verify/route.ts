import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; product: string }>;
}

// Validated here only for the type cast — an unknown value still reaches
// the Control API, which rejects it (parseProductParam) with a real error.
type Product = 'rtc' | 'chat' | 'live-streaming';

export async function POST(_request: Request, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, product } = await params;

  try {
    return NextResponse.json(await ravenApi.verifyIntegration(token, projectId, product as Product));
  } catch (error) {
    return handleApiError(error);
  }
}
