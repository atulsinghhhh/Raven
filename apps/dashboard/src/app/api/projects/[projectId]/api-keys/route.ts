import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json().catch(() => ({}));

  try {
    const key = await ravenApi.createApiKey(token, projectId, { name: typeof body?.name === 'string' ? body.name : undefined });
    return NextResponse.json(key, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
