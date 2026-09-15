import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; streamId: string }>;
}

/**
 * Backs the realtime-triggered refresh on the stream detail page
 * (stream-detail.tsx, Phase 5E). Unlike the list route, this one includes
 * the live viewer count (getLiveStream polls the SFU) — which is exactly
 * why a `live_stream.started`/`ended` nudge on this stream is worth
 * refetching for, beyond just the status badge.
 */
export async function GET(_request: Request, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, streamId } = await params;

  try {
    const stream = await ravenApi.getLiveStream(token, projectId, streamId);
    return NextResponse.json(stream);
  } catch (error) {
    return handleApiError(error);
  }
}
