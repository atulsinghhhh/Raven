import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    await ravenApi.markAllNotificationsRead(token, projectId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
