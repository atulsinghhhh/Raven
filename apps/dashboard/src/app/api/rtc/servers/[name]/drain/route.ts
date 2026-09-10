import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ name: string }>;
}

/**
 * Drains or un-drains one RTC node.
 *
 * Not project-scoped, unlike every other route in this directory: a node
 * is deployment-level infrastructure shared by all projects, so there is
 * no project whose membership could authorize it. Authorization is the
 * developer session alone, matching the Control API's own
 * `DashboardRtcServersController`.
 *
 * Draining does **not** stop the node or end its calls: it stops the
 * allocator choosing it for *new* rooms and lets the existing ones finish.
 * That distinction is the whole point of the endpoint, and the UI says so
 * at the point of clicking instead of only here.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { name } = await params;

  const body = await request.json().catch(() => ({}));
  // Explicit, not a toggle read from current state: two operators
  // looking at the same stale page must not be able to flip a node
  // between pools by both clicking what each thinks is "the other way".
  const draining = body?.draining;
  if (typeof draining !== 'boolean') {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'draining must be true or false' }, { status: 400 });
  }

  try {
    const server = draining ? await ravenApi.drainRtcServer(token, name) : await ravenApi.undrainRtcServer(token, name);
    return NextResponse.json(server);
  } catch (error) {
    return handleApiError(error);
  }
}
