import { NextRequest, NextResponse } from 'next/server';
import { ravenApi, type ProjectRole } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string; userId: string }>;
}

const ROLES: readonly ProjectRole[] = ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER', 'BILLING'];

export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, userId } = await params;

  const body = await request.json().catch(() => ({}));
  if (!ROLES.includes(body?.role)) {
    return NextResponse.json({ message: 'A valid role is required' }, { status: 400 });
  }

  try {
    const member = await ravenApi.updateMemberRole(token, projectId, userId, body.role as ProjectRole);
    return NextResponse.json(member);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId, userId } = await params;

  try {
    await ravenApi.removeMember(token, projectId, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
