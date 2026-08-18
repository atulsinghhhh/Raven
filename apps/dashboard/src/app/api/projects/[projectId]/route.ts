import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json();

  try {
    const project = await ravenApi.updateProject(token, projectId, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      description: typeof body?.description === 'string' ? body.description : undefined,
    });
    return NextResponse.json(project);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  try {
    await ravenApi.archiveProject(token, projectId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
