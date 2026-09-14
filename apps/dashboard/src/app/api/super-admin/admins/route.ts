import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';
import { grantAdmin, type PlatformRoleName } from '@/lib/super-admin/ops';

const VALID_ROLES: PlatformRoleName[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'READ_ONLY'];

/**
 * BFF route for granting a platform role (spec §3/§9). The browser never
 * holds the session JWT — this handler reads it server-side via
 * `requireSessionToken` and forwards the call to
 * `POST /v1/super-admin/admins`, which re-checks `SUPER_ADMIN` itself
 * regardless of what this route assumes.
 */
export async function POST(request: NextRequest) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const platformRole = VALID_ROLES.includes(body?.platformRole) ? (body.platformRole as PlatformRoleName) : undefined;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!email || !platformRole || !reason) {
    return NextResponse.json(
      { code: 'INVALID_BODY', message: 'email, platformRole, and reason are all required' },
      { status: 400 },
    );
  }

  try {
    const admin = await grantAdmin(token, { email, platformRole, reason });
    return NextResponse.json(admin, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
