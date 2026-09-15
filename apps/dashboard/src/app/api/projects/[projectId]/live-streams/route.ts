import { NextRequest, NextResponse } from 'next/server';
import { ravenApi, type LiveStreamStatus } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

const STATUSES: LiveStreamStatus[] = ['CREATED', 'LIVE', 'ENDED'];

/**
 * Backs the realtime-triggered refresh on the Streams list page
 * (streams-list.tsx, Phase 5E) — the initial list is still fetched
 * server-side in page.tsx, same pattern as Connections/Rooms/Webhooks'
 * equivalent routes.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const rawStatus = request.nextUrl.searchParams.get('status') ?? undefined;
  const status = (STATUSES as string[]).includes(rawStatus ?? '') ? (rawStatus as LiveStreamStatus) : undefined;

  try {
    const streams = await ravenApi.listLiveStreams(token, projectId, status);
    return NextResponse.json(streams);
  } catch (error) {
    return handleApiError(error);
  }
}
