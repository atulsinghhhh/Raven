import { assertTokenMatchesRoom, decodeTokenPayload, validateConfig } from '../src/config';
import { RTCError } from '../src/errors';
import { makeToken } from './helpers/token';

describe('validateConfig', () => {
  it('accepts a minimal valid config and fills in sensible defaults', () => {
    const token = makeToken({ video: { room: 'room-1' }, sub: 'alice' });
    const resolved = validateConfig({ token, endpoint: 'wss://rtc.example.com' });

    expect(resolved.token).toBe(token);
    expect(resolved.endpoint).toBe('wss://rtc.example.com');
    expect(resolved.logLevel).toBe('silent');
    expect(resolved.autoReconnect).toBe(true);
    expect(resolved.iceServers).toBeUndefined();
  });

  it('passes through iceServers, logLevel, and autoReconnect when provided', () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const iceServers = [{ urls: 'stun:example.com:3478' }];

    const resolved = validateConfig({
      token,
      endpoint: 'wss://rtc.example.com',
      iceServers,
      logLevel: 'debug',
      autoReconnect: false,
    });

    expect(resolved.iceServers).toBe(iceServers);
    expect(resolved.logLevel).toBe('debug');
    expect(resolved.autoReconnect).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(() => validateConfig({ token: '', endpoint: 'wss://rtc.example.com' })).toThrow(RTCError);
    try {
      validateConfig({ token: '', endpoint: 'wss://rtc.example.com' });
    } catch (error) {
      expect((error as RTCError).code).toBe('INVALID_TOKEN');
    }
  });

  it('rejects a missing endpoint', () => {
    const token = makeToken({ video: { room: 'room-1' } });
    try {
      validateConfig({ token, endpoint: '' });
      throw new Error('expected validateConfig to throw');
    } catch (error) {
      expect((error as RTCError).code).toBe('INVALID_TOKEN');
    }
  });

  it('rejects a malformed (non-JWT) token', () => {
    try {
      validateConfig({ token: 'not-a-jwt', endpoint: 'wss://rtc.example.com' });
      throw new Error('expected validateConfig to throw');
    } catch (error) {
      expect((error as RTCError).code).toBe('INVALID_TOKEN');
    }
  });

  it('rejects an already-expired token', () => {
    const token = makeToken({ video: { room: 'room-1' }, exp: Math.floor(Date.now() / 1000) - 60 });
    try {
      validateConfig({ token, endpoint: 'wss://rtc.example.com' });
      throw new Error('expected validateConfig to throw');
    } catch (error) {
      expect((error as RTCError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('accepts a token that has not expired yet', () => {
    const token = makeToken({ video: { room: 'room-1' }, exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(() => validateConfig({ token, endpoint: 'wss://rtc.example.com' })).not.toThrow();
  });
});

describe('decodeTokenPayload', () => {
  it('reads the room and identity out of the JWT payload without verifying it', () => {
    const token = makeToken({ video: { room: 'room-42' }, sub: 'alice' });
    const decoded = decodeTokenPayload(token);
    expect(decoded.room).toBe('room-42');
    expect(decoded.sub).toBe('alice');
  });
});

describe('assertTokenMatchesRoom', () => {
  it('does not throw when the roomId matches the token', () => {
    const token = makeToken({ video: { room: 'room-1' } });
    expect(() => assertTokenMatchesRoom(token, 'room-1')).not.toThrow();
  });

  it('throws ROOM_NOT_FOUND when the roomId does not match the token', () => {
    const token = makeToken({ video: { room: 'room-1' } });
    try {
      assertTokenMatchesRoom(token, 'room-2');
      throw new Error('expected assertTokenMatchesRoom to throw');
    } catch (error) {
      expect((error as RTCError).code).toBe('ROOM_NOT_FOUND');
      expect((error as RTCError).message).toContain('room-1');
      expect((error as RTCError).message).toContain('room-2');
    }
  });

  it('does not throw when the token carries no room claim at all', () => {
    const token = makeToken({ sub: 'alice' });
    expect(() => assertTokenMatchesRoom(token, 'any-room')).not.toThrow();
  });
});
