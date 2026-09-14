import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';
import { revokeAdmin } from '@/lib/super-admin/ops';

interface Params {
  params: Promise<{ userId: string }>;
}

/**
 * BFF route for revoking a platform role (spec §3/§9). Forwards to
 * `DELETE /v1/super-admin/admins/:userId`, which re-checks `SUPER_ADMIN`
 * and the self-revoke guard server-side — this route does not duplicate
 * either check, it only relays the reason.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { userId } = await params;

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!reason) {
    return NextResponse.json({ code: 'INVALID_BODY', message: 'reason is required' }, { status: 400 });
  }

  try {
    await revokeAdmin(token, userId, reason);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
