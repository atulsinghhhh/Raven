import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

/** Backs the bell's badge count — fetched on mount and after every realtime nudge/reconnect. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    const result = await ravenApi.getUnreadNotificationCount(token, projectId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
