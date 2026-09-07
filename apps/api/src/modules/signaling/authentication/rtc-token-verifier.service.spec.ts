import { ConfigService } from '@nestjs/config';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { RtcTokenSignerService } from '../../rtc-tokens/rtc-token-signer.service';
import { resolvePermissions } from '../../rtc-tokens/rtc-token.claims';
import { Environment } from '../../../shared/environment/environment.constants';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { RtcTokenVerifierService } from './rtc-token-verifier.service';

const SECRET = 'rtc-token-secret-at-least-32-characters-long';

function signerWith(secret = SECRET): RtcTokenSignerService {
  return new RtcTokenSignerService({
    get: jest.fn((key: string) => (key === 'rtcToken.secret' ? secret : undefined)),
  } as unknown as ConfigService);
}

function mintToken(opts: {
  identity?: string;
  roomId?: string;
  roomName?: string;
  projectId?: string;
  environment?: Environment;
  ttlSeconds?: number;
  permissions?: Partial<RtcTokenPermissionsDto>;
  signer?: RtcTokenSignerService;
}): string {
  const signer = opts.signer ?? signerWith();
  return signer.sign({
    projectId: opts.projectId ?? 'p1',
    environment: opts.environment ?? Environment.DEVELOPMENT,
    roomId: opts.roomId ?? 'r1',
    roomName: opts.roomName ?? 'room-1',
    participantIdentity: opts.identity ?? 'alice',
    permissions: resolvePermissions(
      Object.assign(new RtcTokenPermissionsDto(), opts.permissions ?? { join: true, subscribe: true }),
    ),
    ttlSeconds: opts.ttlSeconds ?? 600,
  }).token;
}

describe('RtcTokenVerifierService', () => {
  let service: RtcTokenVerifierService;

  beforeEach(() => {
    service = new RtcTokenVerifierService(signerWith());
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
    const token = mintToken({ signer: signerWith('a-completely-different-secret-value') });

    await expect(service.verify(token)).rejects.toMatchObject({
      code: SignalingErrorCode.INVALID_TOKEN,
    });
  });

  it('rejects an expired token with TOKEN_EXPIRED, not INVALID_TOKEN', async () => {
    // A client whose token merely aged out needs to be told to refresh
    // (spec §21). Minted with the clock wound back so the signature is
    // genuinely valid and only the expiry is against it.
    const realNow = Date.now;
    Date.now = () => realNow() - 3_600_000;
    let token: string;
    try {
      token = mintToken({ ttlSeconds: 60 });
    } finally {
      Date.now = realNow;
    }

    await expect(service.verify(token)).rejects.toMatchObject({
      code: SignalingErrorCode.TOKEN_EXPIRED,
    });
  });

  it('rejects a token whose claims were edited after signing', async () => {
    // The client must never be able to grant itself publish rights by
    // editing the credential it holds (spec §38).
    const token = mintToken({ permissions: { join: true, publish: false } });
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.perms.publish = true;
    const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

    await expect(service.verify(`${header}.${forged}.${signature}`)).rejects.toMatchObject({
      code: SignalingErrorCode.INVALID_TOKEN,
    });
  });

  it('extracts identity, project, room, environment and permissions from a valid token', async () => {
    const token = mintToken({
      identity: 'alice',
      projectId: 'project-42',
      roomId: 'room-42',
      roomName: 'support-room',
      environment: Environment.PRODUCTION,
      permissions: { join: true, subscribe: true, publish: true, publishData: true },
    });

    const result = await service.verify(token);

    expect(result.participantId).toBe('alice');
    expect(result.projectId).toBe('project-42');
    expect(result.roomId).toBe('room-42');
    expect(result.roomName).toBe('support-room');
    expect(result.environment).toBe(Environment.PRODUCTION);
    expect(result.permissions.join).toBe(true);
    expect(result.permissions.subscribe).toBe(true);
    expect(result.permissions.publish).toBe(true);
    expect(result.permissions.publishData).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('exposes the token id so RTC logs can be correlated back to the mint', async () => {
    const signer = signerWith();
    const signed = signer.sign({
      tokenId: 'rtc-token-row-1',
      projectId: 'p1',
      environment: Environment.DEVELOPMENT,
      roomId: 'r1',
      roomName: 'room-1',
      participantIdentity: 'alice',
      permissions: resolvePermissions(new RtcTokenPermissionsDto()),
      ttlSeconds: 600,
    });

    const result = await service.verify(signed.token);
    expect(result.tokenId).toBe('rtc-token-row-1');
  });

  it('reflects join=false when join was not granted', async () => {
    const token = mintToken({ permissions: { join: false } });

    const result = await service.verify(token);
    expect(result.permissions.join).toBe(false);
  });

  it('reports the grant in both the DTO and SFU-facing shapes, in agreement', async () => {
    const token = mintToken({ permissions: { join: true, subscribe: true, publish: true } });

    const result = await service.verify(token);
    expect(result.grant).toEqual({ ...result.permissions });
  });
});
