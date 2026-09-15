/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/projects/[projectId]/members/route';
import { ApiError, type ProjectMember } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session';

// This is the one BFF route handler exercised end-to-end (request in,
// response out) as a representative of the ~35 project-scoped routes under
// src/app/api that all share the exact same requireSessionToken /
// handleApiError shape (see route-helpers.test.ts for that shared logic in
// isolation). It doubles as the "Members: invite" and "unauthorized project
// access" coverage called for in Phase 6G.
jest.mock('@/lib/session', () => ({
  getSessionToken: jest.fn(),
}));

jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return {
    ...actual,
    ravenApi: { addMember: jest.fn() },
  };
});

import { ravenApi } from '@/lib/api-client';

const mockGetSessionToken = getSessionToken as jest.Mock;
const mockAddMember = ravenApi.addMember as jest.Mock;

function request(body: unknown) {
  return new NextRequest('http://localhost:3001/api/projects/proj_1/members', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ projectId: 'proj_1' }) };
}

function member(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    userId: 'user_2',
    email: 'new-member@example.com',
    name: null,
    role: 'VIEWER',
    capabilities: [],
    invitedById: 'user_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('POST /api/projects/[projectId]/members', () => {
  beforeEach(() => {
    mockGetSessionToken.mockReset();
    mockAddMember.mockReset();
  });

  it('returns 401 and never calls the Control API when there is no session', async () => {
    mockGetSessionToken.mockResolvedValue(undefined);

    const res = await POST(request({ email: 'new-member@example.com' }), params());

    expect(res.status).toBe(401);
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('rejects a missing email with 400 before ever reaching the Control API', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');

    const res = await POST(request({}), params());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('invites with a recognised role and returns 201 with the created member', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');
    mockAddMember.mockResolvedValue(member({ role: 'ADMIN' }));

    const res = await POST(request({ email: 'new-member@example.com', role: 'ADMIN' }), params());

    expect(res.status).toBe(201);
    expect(mockAddMember).toHaveBeenCalledWith('jwt', 'proj_1', { email: 'new-member@example.com', role: 'ADMIN' });
    const body = await res.json();
    expect(body.email).toBe('new-member@example.com');
  });

  it('drops an unrecognised role instead of forwarding a typo to the Control API', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');
    mockAddMember.mockResolvedValue(member());

    await POST(request({ email: 'new-member@example.com', role: 'SUPERUSER' }), params());

    expect(mockAddMember).toHaveBeenCalledWith('jwt', 'proj_1', { email: 'new-member@example.com', role: undefined });
  });

  it('passes through a 403 from the Control API — the real enforcement of who may invite members to this project', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');
    mockAddMember.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You cannot manage members on this project'));

    const res = await POST(request({ email: 'new-member@example.com' }), params());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('passes through a 404 when the project does not exist or is not accessible to this session', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');
    mockAddMember.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Project not found'));

    const res = await POST(request({ email: 'new-member@example.com' }), params());

    expect(res.status).toBe(404);
  });

  it('reports a 502 rather than crashing when the Control API is unreachable', async () => {
    mockGetSessionToken.mockResolvedValue('jwt');
    mockAddMember.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the Control API'));

    const res = await POST(request({ email: 'new-member@example.com' }), params());

    expect(res.status).toBe(502);
  });
});
