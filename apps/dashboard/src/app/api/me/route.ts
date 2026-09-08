import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

export async function GET() {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    return NextResponse.json(await ravenApi.getMe(token));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  try {
    const { name } = await request.json();
    return NextResponse.json(await ravenApi.updateMe(token, { name: typeof name === 'string' ? name : undefined }));
  } catch (error) {
    return handleApiError(error);
  }
}
