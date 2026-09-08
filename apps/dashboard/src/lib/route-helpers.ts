import { NextResponse } from 'next/server';
import { ApiError } from './api-client';
import { getSessionToken } from './session';

// Every authenticated route handler starts with this: no session, no request.
export async function requireSessionToken(): Promise<string | NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Not signed in' }, { status: 401 });
  }
  return token;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

// Forwards the API's status/code/message: never leaks a raw stack trace.
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }
  return NextResponse.json({ code: 'NETWORK_ERROR', message: 'Could not reach the Control API' }, { status: 502 });
}
