import { NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

// Mints a short-lived dashboard realtime token (Phase 5B). Same shape as
// the RTC test-token route: the httpOnly session cookie never leaves this
// server, and the browser only ever receives the short-lived,
// project-scoped token this returns.
export async function POST(_request: Request, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    const issued = await ravenApi.createDashboardWsToken(token, projectId);
    return NextResponse.json(issued, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
