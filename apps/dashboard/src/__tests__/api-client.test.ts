import { ApiError, ravenApi } from '@/lib/api-client';

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('ravenApi', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('resolves with the parsed JSON body on success', async () => {
    mockFetchOnce(200, [{ id: 'p1', name: 'Project One' }]);
    const projects = await ravenApi.listProjects('token-123');
    expect(projects).toEqual([{ id: 'p1', name: 'Project One' }]);
  });

  it('sends the Authorization header with the given token', async () => {
    mockFetchOnce(200, []);
    await ravenApi.listProjects('secret-token');
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer secret-token');
  });

  it('throws ApiError with the backend-provided status/code/message on failure', async () => {
    mockFetchOnce(404, { code: 'NOT_FOUND', message: 'Project not found' });

    await expect(ravenApi.getProject('token', 'missing-id')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Project not found',
    });
  });

  it('is an instance of ApiError specifically (not a generic Error)', async () => {
    mockFetchOnce(401, { code: 'UNAUTHORIZED', message: 'Invalid session' });

    try {
      await ravenApi.listProjects('bad-token');
      throw new Error('expected listProjects to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });

  it('returns undefined for a 204 No Content response, without attempting to parse a body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => {
      throw new Error('should not be called for 204');
    } });

    await expect(ravenApi.revokeApiKey('token', 'p1', 'k1')).resolves.toBeUndefined();
  });

  it('never includes the raw secret in any listApiKeys shape (type-level: ApiKeySummary has no `key` field)', async () => {
    mockFetchOnce(200, [{ id: 'k1', projectId: 'p1', publicId: 'rvk_abc', name: null, status: 'ACTIVE', lastUsedAt: null, createdAt: '2026-01-01' }]);
    const keys = await ravenApi.listApiKeys('token', 'p1');
    expect(keys[0]).not.toHaveProperty('key');
    expect(keys[0]).not.toHaveProperty('secretHash');
  });

  describe('observability (Phase 9)', () => {
    it('listConnections appends roomId/state as query params when given', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listConnections('token', 'p1', { roomId: 'room-1', state: 'CONNECTED' });

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/v1/projects/p1/connections?');
      expect(url).toContain('roomId=room-1');
      expect(url).toContain('state=CONNECTED');
    });

    it('listConnections omits the query string entirely when no filters are given', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listConnections('token', 'p1');

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toMatch(/\/v1\/projects\/p1\/connections$/);
    });

    it('getConnection fetches the connection detail by its public conn_... ID', async () => {
      mockFetchOnce(200, { publicId: 'conn_abc', events: [], errors: [] });
      const connection = await ravenApi.getConnection('token', 'p1', 'conn_abc');
      expect(connection.publicId).toBe('conn_abc');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/v1/projects/p1/connections/conn_abc');
    });

    it('listErrors never coerces a classified category — it passes the raw string through', async () => {
      mockFetchOnce(200, [{ publicId: 'err_abc', category: 'TOKEN_ERROR', message: 'expired' }]);
      const errors = await ravenApi.listErrors('token', 'p1', { category: 'TOKEN_ERROR' });
      expect(errors[0].category).toBe('TOKEN_ERROR');
    });

    it('getMetrics forwards the range query param', async () => {
      mockFetchOnce(200, { range: '24h', activeRooms: 0, activeParticipants: 0, connections: 0, connectionSuccessRate: null, reconnectionRate: null, averageConnectionDurationMs: null, errors: 0 });
      await ravenApi.getMetrics('token', 'p1', '24h');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('range=24h');
    });

    it('getDiagnostics never fabricates a healthy status — passes the real backend response through untouched', async () => {
      mockFetchOnce(200, {
        project: { id: 'p1', name: 'demo' },
        api: 'up',
        authentication: 'ok',
        dependencies: { signaling: 'up', sfu: 'down', turn: 'up' },
        connections: { active: 0 },
      });
      const diagnostics = await ravenApi.getDiagnostics('token', 'p1');
      expect(diagnostics.dependencies.sfu).toBe('down');
    });
  });
});
