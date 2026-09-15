import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; notificationId: string }>;
}

export async function PATCH(_request: Request, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, notificationId } = await params;

  try {
    const updated = await ravenApi.markNotificationRead(token, projectId, notificationId);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
