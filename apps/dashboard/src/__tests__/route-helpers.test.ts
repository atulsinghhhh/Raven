/**
 * @jest-environment node
 */
import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

jest.mock('@/lib/session', () => ({
  getSessionToken: jest.fn(),
}));

const mockGetSessionToken = getSessionToken as jest.Mock;

// This is the shared boundary every one of the ~35 project-scoped BFF route
// handlers under src/app/api starts and ends with — it is the actual
// enforcement point for "no session" and for forwarding the Control API's
// authorization decisions (403/404) back to the browser. A bug here is a
// bug in every route at once, which is exactly why it gets dedicated
// coverage instead of relying on each route to re-prove it.
describe('requireSessionToken', () => {
  beforeEach(() => {
    mockGetSessionToken.mockReset();
  });

  it('returns a 401 NextResponse when there is no session cookie', async () => {
    mockGetSessionToken.mockResolvedValue(undefined);

    const result = await requireSessionToken();

    expect(isResponse(result)).toBe(true);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ code: 'UNAUTHORIZED', message: 'Not signed in' });
  });

  it('returns the raw token string when a session cookie is present', async () => {
    mockGetSessionToken.mockResolvedValue('jwt.does.not.matter');

    const result = await requireSessionToken();

    expect(isResponse(result)).toBe(false);
    expect(result).toBe('jwt.does.not.matter');
  });
});

describe('isResponse', () => {
  it('is true for a NextResponse', () => {
    expect(isResponse(NextResponse.json({ ok: true }))).toBe(true);
  });

  it('is false for a plain string (the token case every caller must distinguish)', () => {
    expect(isResponse('a-token')).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isResponse(undefined)).toBe(false);
  });
});

describe('handleApiError', () => {
  it('forwards a 403 from the Control API as-is — this is the actual "unauthorized project access" enforcement, not the login proxy', async () => {
    const response = handleApiError(new ApiError(403, 'FORBIDDEN', 'You do not have access to this project'));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ code: 'FORBIDDEN', message: 'You do not have access to this project' });
  });

  it('forwards a 404 from the Control API as-is', async () => {
    const response = handleApiError(new ApiError(404, 'NOT_FOUND', 'Project not found'));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Project not found' });
  });

  it('maps ApiError status 0 (fetch never got a response) to a 502 gateway error', async () => {
    const response = handleApiError(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the Control API'));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('NETWORK_ERROR');
  });

  it('maps any non-ApiError throw to a 502 without leaking the original error', async () => {
    const response = handleApiError(new TypeError('fetch is not defined'));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ code: 'NETWORK_ERROR', message: 'Could not reach the Control API' });
  });

  it('never echoes a raw error message from an unrecognised throw — no stack trace or internal detail reaches the browser', async () => {
    const response = handleApiError('a bare string throw, not even an Error');

    const body = await response.json();
    expect(body.message).toBe('Could not reach the Control API');
    expect(JSON.stringify(body)).not.toContain('bare string throw');
  });

  describe('request correlation (Phase 6H)', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('forwards requestId in the JSON body alongside code/message', async () => {
      const response = handleApiError(new ApiError(500, 'INTERNAL_ERROR', 'boom', 'req_abc123'));

      const body = await response.json();
      expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req_abc123' });
    });

    it('logs server-side, with the requestId, for a 5xx failure', async () => {
      handleApiError(new ApiError(500, 'INTERNAL_ERROR', 'boom', 'req_abc123'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[BFF] upstream request failed',
        expect.objectContaining({ requestId: 'req_abc123', status: 500, code: 'INTERNAL_ERROR' }),
      );
    });

    it('does not log for an ordinary 4xx — validation/not-found/forbidden are expected outcomes, not failures', async () => {
      handleApiError(new ApiError(403, 'FORBIDDEN', 'You do not have access to this project', 'req_xyz'));
      handleApiError(new ApiError(404, 'NOT_FOUND', 'Project not found', 'req_xyz'));

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('logs a network-unreachable failure (status 0 → 502) with its requestId too', async () => {
      handleApiError(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the Control API', 'req_offline'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[BFF] upstream request failed',
        expect.objectContaining({ requestId: 'req_offline', status: 502 }),
      );
    });
  });
});
