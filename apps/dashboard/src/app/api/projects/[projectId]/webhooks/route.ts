import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

/**
 * Backs the realtime-triggered refresh on the Webhooks page
 * (webhooks-manager.tsx, Phase 5D) — the initial list is still fetched
 * server-side in page.tsx, same pattern as Connections/Rooms' equivalent
 * routes. Also the natural place a future manual-refresh control would
 * call, though nothing does yet.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    const endpoints = await ravenApi.listWebhooks(token, projectId);
    return NextResponse.json(endpoints);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json().catch(() => ({}));
  if (typeof body?.url !== 'string' || body.url.length === 0) {
    return NextResponse.json({ code: 'VALIDATION_FAILED', message: 'url is required' }, { status: 400 });
  }

  try {
    // The signing secret comes back exactly once, in this response. It's
    // forwarded straight to the browser and never persisted here.
    const endpoint = await ravenApi.createWebhook(token, projectId, {
      url: body.url,
      description: typeof body.description === 'string' ? body.description : undefined,
      events: Array.isArray(body.events) ? body.events : undefined,
    });
    return NextResponse.json(endpoint, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
