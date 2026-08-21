import { NextRequest, NextResponse } from 'next/server';
import { ravenApi, type Environment } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

const VALID_ENVIRONMENTS: Environment[] = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'];

export async function POST(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json().catch(() => ({}));
  const environment = VALID_ENVIRONMENTS.includes(body?.environment) ? (body.environment as Environment) : undefined;

  try {
    const key = await ravenApi.createApiKey(token, projectId, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      environment,
    });
    return NextResponse.json(key, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
