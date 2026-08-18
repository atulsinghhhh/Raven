import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; webhookId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, webhookId } = await params;

  const body = await request.json().catch(() => ({}));

  try {
    const endpoint = await ravenApi.updateWebhook(token, projectId, webhookId, {
      url: typeof body?.url === 'string' ? body.url : undefined,
      events: Array.isArray(body?.events) ? body.events : undefined,
      status: body?.status === 'ACTIVE' || body?.status === 'DISABLED' ? body.status : undefined,
    });
    return NextResponse.json(endpoint);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, webhookId } = await params;

  try {
    await ravenApi.deleteWebhook(token, projectId, webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
