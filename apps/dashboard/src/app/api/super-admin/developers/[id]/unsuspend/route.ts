import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { unsuspendDeveloper } from '@/lib/super-admin/developers';

interface Params {
  params: Promise<{ id: string }>;
}

/** Same shape as `suspend/route.ts` — see that file's doc comment. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const token = await getSessionToken();
  const detailUrl = new URL(`/super-admin/developers/${id}`, request.url);

  if (!token) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(detailUrl.pathname)}`, request.url), 303);
  }

  const form = await request.formData();
  const reason = String(form.get('reason') ?? '').trim();

  if (!reason) {
    detailUrl.searchParams.set('error', 'reason_required');
    return NextResponse.redirect(detailUrl, 303);
  }

  try {
    await unsuspendDeveloper(token, id, reason);
  } catch (error) {
    detailUrl.searchParams.set('error', error instanceof ApiError ? String(error.status) : 'unknown');
    return NextResponse.redirect(detailUrl, 303);
  }

  return NextResponse.redirect(detailUrl, 303);
}
