import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { suspendDeveloper } from '@/lib/super-admin/developers';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Backs the plain `<form action="..." method="POST">` on the developer
 * detail page's "Suspend account" action. Unlike the JSON route handlers
 * elsewhere in `app/api/*`, this one is hit by a real browser form
 * submission — so it reads `formData()`, not `request.json()`, and
 * responds with a redirect back to the detail page rather than a JSON
 * body, since there is no fetch caller here to parse one.
 *
 * The API (`PlatformRoleGuard` + `@RequirePlatformRole(SUPER_ADMIN, ADMIN)`)
 * is the actual authorization boundary — a SUPPORT/READ_ONLY admin whose
 * browser somehow posts here still gets rejected server-side, this route
 * just forwards that rejection back as a query-param the page can show.
 */
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
    await suspendDeveloper(token, id, reason);
  } catch (error) {
    detailUrl.searchParams.set('error', error instanceof ApiError ? String(error.status) : 'unknown');
    return NextResponse.redirect(detailUrl, 303);
  }

  return NextResponse.redirect(detailUrl, 303);
}
