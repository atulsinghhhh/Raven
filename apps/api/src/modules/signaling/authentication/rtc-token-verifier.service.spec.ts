import { ConfigService } from '@nestjs/config';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { RtcTokenRevocationService } from '../../rtc-tokens/rtc-token-revocation.service';
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

/**
 * A stand-in for the Redis-backed revocation store.
 *
 * `revoked` is the set of token ids to treat as killed; `failing` makes
 * every lookup throw, which is how the fail-open behaviour gets exercised
 * without a Redis instance.
 */
function revocationsWith(opts: { revoked?: string[]; failing?: boolean } = {}): {
  service: RtcTokenRevocationService;
  isRevoked: jest.Mock;
} {
  const revoked = new Set(opts.revoked ?? []);
  const isRevoked = jest.fn(async (tokenId: string) => {
    if (opts.failing) {
      // Matches the real service's contract: it swallows the Redis error
      // and answers "not revoked" rather than propagating.
      return false;
    }
    return revoked.has(tokenId);
  });
  return { service: { isRevoked } as unknown as RtcTokenRevocationService, isRevoked };
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
    service = new RtcTokenVerifierService(signerWith(), revocationsWith().service);
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

  describe('revocation', () => {
    function verifierWith(revoked: string[]): RtcTokenVerifierService {
      return new RtcTokenVerifierService(signerWith(), revocationsWith({ revoked }).service);
    }

    function mintWithId(tokenId: string, ttlSeconds = 600): string {
      return signerWith().sign({
        tokenId,
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
        roomId: 'r1',
        roomName: 'room-1',
        participantIdentity: 'alice',
        permissions: resolvePermissions(Object.assign(new RtcTokenPermissionsDto(), { join: true, subscribe: true })),
        ttlSeconds,
      }).token;
    }

    it('accepts a valid token that has not been revoked', async () => {
      const token = mintWithId('rtk-live');

      const result = await verifierWith([]).verify(token);
      expect(result.tokenId).toBe('rtk-live');
    });

    it('rejects a revoked token with TOKEN_REVOKED', async () => {
      const token = mintWithId('rtk-killed');

      await expect(verifierWith(['rtk-killed']).verify(token)).rejects.toMatchObject({
        code: SignalingErrorCode.TOKEN_REVOKED,
      });
    });

    it('keeps TOKEN_REVOKED distinct from INVALID_TOKEN and TOKEN_EXPIRED', async () => {
      // Three different remedies: mint a new one because someone killed
      // this one, mint a new one because it aged out, and "your signature
      // is wrong". Collapsing them would make the first two
      // indistinguishable from a misconfiguration.
      const revoked = mintWithId('rtk-killed');
      await expect(verifierWith(['rtk-killed']).verify(revoked)).rejects.toMatchObject({
        code: SignalingErrorCode.TOKEN_REVOKED,
      });
      await expect(verifierWith(['rtk-killed']).verify('not.a.jwt')).rejects.toMatchObject({
        code: SignalingErrorCode.INVALID_TOKEN,
      });
    });

    it('revoking one token does not affect another', async () => {
      // The tombstone is keyed by jti, so it must not spill across tokens.
      const other = mintWithId('rtk-other');

      const result = await verifierWith(['rtk-killed']).verify(other);
      expect(result.tokenId).toBe('rtk-other');
    });

    it('treats an unknown revocation entry as a normal valid token', async () => {
      // The absence of a tombstone is the common case, not an unknown
      // answer: it must read as "not revoked".
      const token = mintWithId('rtk-never-seen');

      const result = await verifierWith([]).verify(token);
      expect(result.tokenId).toBe('rtk-never-seen');
    });

    it('rejects an expired token before spending a revocation lookup on it', async () => {
      // Expiry is a local check and revocation is a network one, so an
      // aged-out token must never reach Redis.
      const { service: revocations, isRevoked } = revocationsWith();
      const verifier = new RtcTokenVerifierService(signerWith(), revocations);

      const realNow = Date.now;
      Date.now = () => realNow() - 3_600_000;
      let token: string;
      try {
        token = mintWithId('rtk-stale', 60);
      } finally {
        Date.now = realNow;
      }

      await expect(verifier.verify(token)).rejects.toMatchObject({
        code: SignalingErrorCode.TOKEN_EXPIRED,
      });
      expect(isRevoked).not.toHaveBeenCalled();
    });

    it('never looks up a revocation for a token whose signature failed', async () => {
      // Otherwise this is an oracle: an attacker could probe the
      // revocation keyspace with jti values they made up.
      const { service: revocations, isRevoked } = revocationsWith();
      const verifier = new RtcTokenVerifierService(signerWith(), revocations);
      const forged = mintToken({ signer: signerWith('a-completely-different-secret-value') });

      await expect(verifier.verify(forged)).rejects.toMatchObject({
        code: SignalingErrorCode.INVALID_TOKEN,
      });
      expect(isRevoked).not.toHaveBeenCalled();
    });

    it('allows a valid token when the revocation store is unreachable', async () => {
      // Degraded revocation, not a total outage of RTC. Documented in
      // RtcTokenRevocationService.
      const token = mintWithId('rtk-live');
      const verifier = new RtcTokenVerifierService(signerWith(), revocationsWith({ failing: true }).service);

      const result = await verifier.verify(token);
      expect(result.tokenId).toBe('rtk-live');
    });
  });
});
