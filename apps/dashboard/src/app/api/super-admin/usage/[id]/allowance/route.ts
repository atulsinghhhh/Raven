import { NextRequest, NextResponse } from 'next/server';
import { updateAllowance, type UsageProduct } from '@/lib/super-admin/usage';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ id: string }>;
}

const PRODUCTS: readonly UsageProduct[] = ['RTC', 'CHAT', 'LIVE_STREAMING'];

/**
 * BFF passthrough for the allowance-edit form
 * (`apps/dashboard/src/app/super-admin/usage/developers/[id]/allowance-form.tsx`)
 * to `PATCH /v1/super-admin/usage/developers/:userId/allowance`. This route
 * does not itself decide who may call it — the API's `PlatformRoleGuard` +
 * `@RequirePlatformRole(SUPER_ADMIN, ADMIN)` is the real gate, and re-checks
 * on every request regardless of what this handler assumes. The
 * shape-validation here (reason non-empty, product recognised) is only to
 * fail fast with a friendly message before round-tripping to the API.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));

  if (!PRODUCTS.includes(body?.product)) {
    return NextResponse.json({ code: 'VALIDATION_FAILED', message: 'A valid product is required' }, { status: 400 });
  }
  if (typeof body?.reason !== 'string' || body.reason.trim().length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_FAILED', message: 'A reason is required to change a limit' },
      { status: 400 },
    );
  }

  try {
    const result = await updateAllowance(token, id, {
      product: body.product,
      includedMinutes: typeof body.includedMinutes === 'number' ? body.includedMinutes : undefined,
      includedCount: typeof body.includedCount === 'number' ? body.includedCount : undefined,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
