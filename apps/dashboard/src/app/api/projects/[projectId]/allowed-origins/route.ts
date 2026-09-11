import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

interface Params {
  params: Promise<{ projectId: string }>;
}

/**
 * Proxies the origin allow-list update through the dashboard's own session,
 * like every other write here: the browser never holds a Livqeno credential,
 * and the Control API is not called cross-origin from the page.
 *
 * The list is sent whole rather than as a delta — otherwise "remove this
 * origin" has no representation. Validation belongs to the Control API,
 * which rejects anything that is not an origin and names the offenders, so
 * this only checks the shape.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;
  const { projectId } = await params;

  const body = await request.json();
  if (!Array.isArray(body?.allowedOrigins)) {
    return NextResponse.json({ message: 'allowedOrigins must be an array' }, { status: 400 });
  }

  try {
    const result = await ravenApi.updateAllowedOrigins(token, projectId, {
      allowedOrigins: body.allowedOrigins.map(String),
      allowLocalhostOrigins: typeof body?.allowLocalhostOrigins === 'boolean' ? body.allowLocalhostOrigins : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
