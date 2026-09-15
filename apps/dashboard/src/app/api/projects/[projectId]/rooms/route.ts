import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

/**
 * Backs the realtime-triggered refresh on the Rooms page (rooms-list.tsx,
 * Phase 5C). The initial list is still fetched server-side in page.tsx,
 * same as connections' equivalent route — this only serves the refetch a
 * `room.created` nudge triggers, since that's a client interaction with
 * no server round-trip of its own to piggyback on.
 */
export async function GET(_request: Request, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    const rooms = await ravenApi.listRooms(token, projectId);
    return NextResponse.json(rooms);
  } catch (error) {
    return handleApiError(error);
  }
}
