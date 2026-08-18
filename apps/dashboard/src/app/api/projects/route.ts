import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

export async function GET() {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    return NextResponse.json(await ravenApi.listProjects(token));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  const body = await request.json();
  if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'name is required' }, { status: 400 });
  }

  try {
    const project = await ravenApi.createProject(token, { name: body.name, description: body.description });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
