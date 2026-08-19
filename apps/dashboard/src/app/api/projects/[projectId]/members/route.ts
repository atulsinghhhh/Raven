import { NextRequest, NextResponse } from 'next/server';
import { ravenApi, type ProjectRole } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

const ROLES: readonly ProjectRole[] = ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER', 'BILLING'];

export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email : undefined;

  if (!email) {
    return NextResponse.json({ message: 'An email address is required' }, { status: 400 });
  }

  // An unrecognised role is dropped rather than forwarded — the API would
  // reject it anyway, and letting it through turns a typo into a confusing
  // 400 from a layer the developer isn't looking at.
  const role = ROLES.includes(body?.role) ? (body.role as ProjectRole) : undefined;

  try {
    const member = await ravenApi.addMember(token, projectId, { email, role });
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
