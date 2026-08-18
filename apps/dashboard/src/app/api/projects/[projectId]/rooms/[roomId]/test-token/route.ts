import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; roomId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, roomId } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const issued = await ravenApi.createTestToken(
      token,
      projectId,
      roomId,
      typeof body?.participantIdentity === 'string' ? body.participantIdentity : undefined,
    );
    return NextResponse.json(issued, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
