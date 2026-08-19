import { LiveStreamsResource } from '../../src/resources/live-streams';
import type { RavenHttpClient } from '../../src/http-client';

describe('LiveStreamsResource', () => {
  it('create() POSTs the stream params', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'stream_1' }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.create({ title: 'Q&A', hostIdentity: 'user-1' });

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams', {
      method: 'POST',
      body: { title: 'Q&A', hostIdentity: 'user-1' },
    });
  });

  it('list() calls GET /v1/live-streams with no query by default', async () => {
    const http = { request: jest.fn().mockResolvedValue([]) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.list();

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams');
  });

  it('list() filters by status', async () => {
    const http = { request: jest.fn().mockResolvedValue([]) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.list({ status: 'LIVE' });

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams?status=LIVE');
  });

  it('get() calls GET /v1/live-streams/:id', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'stream_1' }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.get('stream_1');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1');
  });

  it('update() PATCHes the given fields', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'stream_1' }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.update('stream_1', { title: 'New title' });

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1', {
      method: 'PATCH',
      body: { title: 'New title' },
    });
  });

  it('start() POSTs to the start endpoint', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'stream_1', status: 'LIVE' }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.start('stream_1');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/start', { method: 'POST' });
  });

  it('end() POSTs to the end endpoint', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'stream_1', status: 'ENDED' }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.end('stream_1');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/end', { method: 'POST' });
  });

  it('addHost() POSTs identity and role, minting host credentials', async () => {
    const http = { request: jest.fn().mockResolvedValue({ identity: 'user-2', role: 'CO_HOST', rtc: {}, chat: {} }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.addHost('stream_1', { identity: 'user-2' });

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/hosts', {
      method: 'POST',
      body: { identity: 'user-2' },
    });
  });

  it('removeHost() DELETEs the host by identity', async () => {
    const http = { request: jest.fn().mockResolvedValue(undefined) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.removeHost('stream_1', 'user-2');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/hosts/user-2', { method: 'DELETE' });
  });

  it('createViewerToken() POSTs the identity, never a role', async () => {
    const http = { request: jest.fn().mockResolvedValue({ identity: 'user-3', role: 'VIEWER', rtc: {} }) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.createViewerToken('stream_1', 'user-3');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/viewer-tokens', {
      method: 'POST',
      body: { identity: 'user-3' },
    });
  });

  it('leave() POSTs the identity as a clean-leave signal', async () => {
    const http = { request: jest.fn().mockResolvedValue(undefined) };
    const resource = new LiveStreamsResource(http as unknown as RavenHttpClient);

    await resource.leave('stream_1', 'user-3');

    expect(http.request).toHaveBeenCalledWith('/v1/live-streams/stream_1/leave', {
      method: 'POST',
      body: { identity: 'user-3' },
    });
  });
});
