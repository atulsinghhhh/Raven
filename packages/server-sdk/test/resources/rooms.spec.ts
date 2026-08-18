import { RoomsResource } from '../../src/resources/rooms';
import type { RavenHttpClient } from '../../src/http-client';

describe('RoomsResource', () => {
  it('list() calls GET /v1/rooms', async () => {
    const http = { request: jest.fn().mockResolvedValue([]) };
    const resource = new RoomsResource(http as unknown as RavenHttpClient);

    await resource.list();

    expect(http.request).toHaveBeenCalledWith('/v1/rooms');
  });

  it('get() calls GET /v1/rooms/:id', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'r1' }) };
    const resource = new RoomsResource(http as unknown as RavenHttpClient);

    await resource.get('r1');

    expect(http.request).toHaveBeenCalledWith('/v1/rooms/r1');
  });

  it('create() POSTs the room name', async () => {
    const http = { request: jest.fn().mockResolvedValue({ id: 'r1', name: 'lobby' }) };
    const resource = new RoomsResource(http as unknown as RavenHttpClient);

    await resource.create({ name: 'lobby' });

    expect(http.request).toHaveBeenCalledWith('/v1/rooms', { method: 'POST', body: { name: 'lobby' } });
  });

  it('delete() soft-closes via DELETE, never a hard destroy', async () => {
    const http = { request: jest.fn().mockResolvedValue(undefined) };
    const resource = new RoomsResource(http as unknown as RavenHttpClient);

    await resource.delete('r1');

    expect(http.request).toHaveBeenCalledWith('/v1/rooms/r1', { method: 'DELETE' });
  });

  describe('participants', () => {
    it('list() returns the live participant list', async () => {
      const http = { request: jest.fn().mockResolvedValue([{ identity: 'alice', joinedAt: '2026-01-01', tracks: [] }]) };
      const resource = new RoomsResource(http as unknown as RavenHttpClient);

      const participants = await resource.participants.list('r1');

      expect(http.request).toHaveBeenCalledWith('/v1/rooms/r1/participants');
      expect(participants).toHaveLength(1);
    });

    it('list() passes through null (SFU unreachable) rather than fabricating an empty array', async () => {
      const http = { request: jest.fn().mockResolvedValue(null) };
      const resource = new RoomsResource(http as unknown as RavenHttpClient);

      await expect(resource.participants.list('r1')).resolves.toBeNull();
    });

    it('get() finds one participant by identity from the live list', async () => {
      const http = {
        request: jest.fn().mockResolvedValue([
          { identity: 'alice', joinedAt: '2026-01-01', tracks: [] },
          { identity: 'bob', joinedAt: '2026-01-01', tracks: [] },
        ]),
      };
      const resource = new RoomsResource(http as unknown as RavenHttpClient);

      const bob = await resource.participants.get('r1', 'bob');
      expect(bob?.identity).toBe('bob');

      const missing = await resource.participants.get('r1', 'carol');
      expect(missing).toBeNull();
    });

    it('get() returns null (not throw) when the SFU is unreachable', async () => {
      const http = { request: jest.fn().mockResolvedValue(null) };
      const resource = new RoomsResource(http as unknown as RavenHttpClient);

      await expect(resource.participants.get('r1', 'alice')).resolves.toBeNull();
    });
  });
});
