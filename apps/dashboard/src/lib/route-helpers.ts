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
// Also forwards `requestId` — apiFetch (api-client.ts) mints one for every
// outbound call and sends it as `x-request-id`, and the API echoes it back
// on every error body (AllExceptionsFilter). Carrying it through to the
// browser is what turns "a developer reports a failure" into "grep this
// one id across both services' logs" instead of matching on a timestamp.
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    // status 0 means apiFetch never got a response at all (fetch() threw) — there's no
    // real upstream status to forward, so report it as a gateway failure.
    const status = error.status === 0 ? 502 : error.status;
    // Only failures worth an operator's attention: a 4xx is an ordinary,
    // expected outcome (validation, not-found, permission) and logging
    // every one would drown the signal this exists to surface. 5xx and
    // "couldn't reach the API at all" (mapped to 502 above) are not.
    if (status >= 500) {
      console.error('[BFF] upstream request failed', {
        requestId: error.requestId,
        status,
        code: error.code,
        message: error.message,
      });
    }
    return NextResponse.json({ code: error.code, message: error.message, requestId: error.requestId }, { status });
  }
  // Not even an ApiError — apiFetch never got the chance to attach a request
  // id, so there is nothing to correlate beyond this line itself.
  console.error('[BFF] request failed with a non-ApiError exception', error);
  return NextResponse.json({ code: 'NETWORK_ERROR', message: 'Could not reach the Control API' }, { status: 502 });
}
