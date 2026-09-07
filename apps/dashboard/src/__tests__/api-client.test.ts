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

    it('listLiveStreams forwards a status filter', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listLiveStreams('token', 'p1', 'LIVE');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('status=LIVE');
    });

    it('listLiveStreams omits the query entirely when no status is given', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listLiveStreams('token', 'p1');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).not.toContain('status=');
    });

    it('getLiveStream fetches one stream by its stream_... ID', async () => {
      mockFetchOnce(200, { id: 'stream_abc', title: 'Friday Q&A', status: 'LIVE', viewerCount: 12 });
      const stream = await ravenApi.getLiveStream('token', 'p1', 'stream_abc');
      expect(stream.viewerCount).toBe(12);
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/v1/projects/p1/live-streams/stream_abc');
    });
  });
  /**
   * The fleet endpoints are deployment-level, not project-scoped — an SFU
   * node is shared infrastructure, so there is no project whose
   * membership could authorize it. These tests pin that URL shape,
   * because a project segment creeping in would 404 rather than fail
   * loudly.
   */
  describe('RTC fleet', () => {
    it('lists the fleet without a project segment', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listRtcServers('token');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/v1/rtc/servers');
      expect(url).not.toContain('/projects/');
    });

    it('forwards a region filter, encoded', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listRtcServers('token', 'asia south');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('region=asia%20south');
    });

    it('omits the query entirely when no region is given', async () => {
      mockFetchOnce(200, []);
      await ravenApi.listRtcServers('token');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).not.toContain('?');
    });

    it('passes fleet metrics through untouched, including a zero capacity', async () => {
      // A fleet with no registered node has capacity 0, and the caller has
      // to be able to tell that from "the request failed" — so nothing here
      // substitutes a default.
      mockFetchOnce(200, {
        servers: 0,
        healthyServers: 0,
        drainingServers: 0,
        unhealthyServers: 0,
        activeRooms: 0,
        activeParticipants: 0,
        capacity: 0,
      });
      const metrics = await ravenApi.getRtcFleetMetrics('token');
      expect(metrics.servers).toBe(0);
      expect(metrics.capacity).toBe(0);
    });

    it('encodes a node name in the path rather than interpolating it raw', async () => {
      mockFetchOnce(200, {});
      await ravenApi.getRtcServer('token', 'sfu/../admin');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('sfu%2F..%2Fadmin');
      expect(url).not.toContain('sfu/../admin');
    });

    it('drains and un-drains through distinct endpoints, both POST', async () => {
      mockFetchOnce(200, { name: 'sfu-1', status: 'DRAINING' });
      await ravenApi.drainRtcServer('token', 'sfu-1');
      let [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/v1/rtc/servers/sfu-1/drain');
      expect(options.method).toBe('POST');

      mockFetchOnce(200, { name: 'sfu-1', status: 'HEALTHY' });
      await ravenApi.undrainRtcServer('token', 'sfu-1');
      [url, options] = (global.fetch as jest.Mock).mock.calls[1];
      expect(url).toContain('/v1/rtc/servers/sfu-1/undrain');
      expect(options.method).toBe('POST');
    });
  });
});
