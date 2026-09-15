import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

/**
 * The caller's own notifications for this project (Phase 5F) — both the
 * initial NotificationsBell fetch and its realtime-triggered refreshes go
 * through this one route. Same pattern as every other list BFF route.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const search = request.nextUrl.searchParams;
  const rawLimit = Number(search.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const cursor = search.get('cursor') ?? undefined;
  const unreadOnly = search.get('unreadOnly') === 'true';

  try {
    const page = await ravenApi.listNotifications(token, projectId, { limit, cursor, unreadOnly });
    return NextResponse.json(page);
  } catch (error) {
    return handleApiError(error);
  }
}
