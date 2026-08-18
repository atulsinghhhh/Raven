import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { RtcTokenVerifierService } from './rtc-token-verifier.service';

const API_KEY = 'test-key';
const API_SECRET = 'test-secret-at-least-32-characters-long';

function makeConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'livekit.apiKey') return API_KEY;
      if (key === 'livekit.apiSecret') return API_SECRET;
      return undefined;
    }),
  } as unknown as ConfigService;
}

async function mintToken(opts: {
  identity: string;
  roomName: string;
  ttl?: number;
  attributes?: Record<string, string>;
  grant?: Partial<{ roomJoin: boolean; canSubscribe: boolean; canPublish: boolean; canPublishData: boolean }>;
}): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: opts.identity,
    ttl: opts.ttl ?? 600,
    attributes: opts.attributes,
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: opts.grant?.roomJoin ?? true,
    canSubscribe: opts.grant?.canSubscribe ?? true,
    canPublish: opts.grant?.canPublish ?? false,
    canPublishData: opts.grant?.canPublishData ?? false,
  });
  return at.toJwt();
}

describe('RtcTokenVerifierService', () => {
  let service: RtcTokenVerifierService;

  beforeEach(() => {
    service = new RtcTokenVerifierService(makeConfigService());
  });

  it('rejects an empty token', async () => {
    await expect(service.verify('')).rejects.toBeInstanceOf(SignalingError);
  });

  it('rejects a garbage token', async () => {
    await expect(service.verify('not.a.jwt')).rejects.toMatchObject({
      code: SignalingErrorCode.INVALID_TOKEN,
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const at = new AccessToken(API_KEY, 'a-completely-different-secret-value', {
      identity: 'alice',
      attributes: { ravenProjectId: 'p1', ravenRoomId: 'r1' },
    });
    at.addGrant({ room: 'room-1', roomJoin: true });
    const token = await at.toJwt();

    await expect(service.verify(token)).rejects.toMatchObject({ code: SignalingErrorCode.INVALID_TOKEN });
  });

  it('rejects an expired token', async () => {
    const token = await mintToken({
      identity: 'alice',
      roomName: 'room-1',
      ttl: -10, // already expired
      attributes: { ravenProjectId: 'p1', ravenRoomId: 'r1' },
    });

    await expect(service.verify(token)).rejects.toMatchObject({ code: SignalingErrorCode.TOKEN_EXPIRED });
  });

  it('rejects a token missing the raven project/room attributes', async () => {
    const token = await mintToken({ identity: 'alice', roomName: 'room-1' });
    await expect(service.verify(token)).rejects.toMatchObject({ code: SignalingErrorCode.INVALID_TOKEN });
  });

  it('extracts participantId, projectId, roomId, roomName, and permissions from a valid token', async () => {
    const token = await mintToken({
      identity: 'alice',
      roomName: 'support-room',
      attributes: { ravenProjectId: 'project-42', ravenRoomId: 'room-42' },
      grant: { roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: true },
    });

    const result = await service.verify(token);

    expect(result.participantId).toBe('alice');
    expect(result.projectId).toBe('project-42');
    expect(result.roomId).toBe('room-42');
    expect(result.roomName).toBe('support-room');
    expect(result.permissions.join).toBe(true);
    expect(result.permissions.subscribe).toBe(true);
    expect(result.permissions.publish).toBe(true);
    expect(result.permissions.publishData).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reflects join=false when roomJoin was not granted', async () => {
    const token = await mintToken({
      identity: 'alice',
      roomName: 'room-1',
      attributes: { ravenProjectId: 'p1', ravenRoomId: 'r1' },
      grant: { roomJoin: false },
    });

    const result = await service.verify(token);
    expect(result.permissions.join).toBe(false);
  });
});
