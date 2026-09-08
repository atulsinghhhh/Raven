import { ConfigService } from '@nestjs/config';
import { Environment } from '../../shared/environment/environment.constants';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';
import { RtcTokenSignerService, SignRtcTokenInput } from './rtc-token-signer.service';
import { RtcTokenError, resolvePermissions, toPermissionsDto } from './rtc-token.claims';

const SECRET = 'rtc-token-secret-for-tests';

function signerWith(secret = SECRET): RtcTokenSignerService {
  const config = {
    get: (key: string) => (key === 'rtcToken.secret' ? secret : undefined),
  } as unknown as ConfigService;
  return new RtcTokenSignerService(config);
}

function permissions(overrides: Partial<RtcTokenPermissionsDto>): RtcTokenPermissionsDto {
  return Object.assign(new RtcTokenPermissionsDto(), overrides);
}

function signInput(overrides: Partial<SignRtcTokenInput> = {}): SignRtcTokenInput {
  return {
    projectId: 'proj_1',
    environment: Environment.PRODUCTION,
    roomId: 'room_1',
    roomName: 'demo-room',
    participantIdentity: 'user-123',
    permissions: resolvePermissions(permissions({ join: true, subscribe: true })),
    ttlSeconds: 600,
    ...overrides,
  };
}

/** Rebuilds a token with a tampered payload but the original signature. */
function tamperPayload(token: string, mutate: (claims: Record<string, unknown>) => void): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  mutate(claims);
  const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${forged}.${signature}`;
}

describe('resolvePermissions', () => {
  it('denies everything that was not asked for', () => {
    expect(resolvePermissions(new RtcTokenPermissionsDto())).toEqual({
      join: true,
      subscribe: true,
      publish: false,
      publishAudio: false,
      publishVideo: false,
      publishData: false,
    });
  });

  it('denies everything for an undefined request', () => {
    // The DTO's own defaults (join/subscribe true) still apply: the point
    // is that nothing *publishable* is granted by omission.
    const resolved = resolvePermissions(undefined);
    expect(resolved.publish).toBe(false);
    expect(resolved.publishAudio).toBe(false);
    expect(resolved.publishVideo).toBe(false);
    expect(resolved.publishData).toBe(false);
  });

  it('maps join/subscribe/publishData straight through', () => {
    const resolved = resolvePermissions(
      permissions({ join: true, subscribe: true, publish: false, publishData: true }),
    );
    expect(resolved.join).toBe(true);
    expect(resolved.subscribe).toBe(true);
    expect(resolved.publish).toBe(false);
    expect(resolved.publishData).toBe(true);
  });

  it('widens publish with no sub-flags to both audio and video', () => {
    // Preserved from the LiveKit grant mapper: "publish, I don't care what"
    // is the common case, and the sub-flags exist only to narrow it.
    const resolved = resolvePermissions(
      permissions({ publish: true, publishAudio: false, publishVideo: false }),
    );
    expect(resolved.publishAudio).toBe(true);
    expect(resolved.publishVideo).toBe(true);
  });

  it('narrows to audio only when publish+publishAudio', () => {
    const resolved = resolvePermissions(
      permissions({ publish: true, publishAudio: true, publishVideo: false }),
    );
    expect(resolved.publishAudio).toBe(true);
    expect(resolved.publishVideo).toBe(false);
  });

  it('narrows to video only when publish+publishVideo', () => {
    const resolved = resolvePermissions(
      permissions({ publish: true, publishAudio: false, publishVideo: true }),
    );
    expect(resolved.publishAudio).toBe(false);
    expect(resolved.publishVideo).toBe(true);
  });

  it('grants no publishing at all when sub-flags are set without publish', () => {
    // A sub-flag was never independently sufficient: matching the old
    // mapper, which left canPublishSources unset when publish was false.
    const resolved = resolvePermissions(
      permissions({ publish: false, publishAudio: true, publishVideo: true }),
    );
    expect(resolved.publish).toBe(false);
    expect(resolved.publishAudio).toBe(false);
    expect(resolved.publishVideo).toBe(false);
  });
});

describe('toPermissionsDto', () => {
  it('round-trips resolved permissions', () => {
    const resolved = resolvePermissions(
      permissions({ join: true, subscribe: true, publish: true, publishData: true }),
    );
    expect(toPermissionsDto(resolved)).toEqual(resolved);
  });

  it('treats a missing permission as denied, never as granted', () => {
    expect(toPermissionsDto(undefined)).toEqual({
      join: false,
      subscribe: false,
      publish: false,
      publishAudio: false,
      publishVideo: false,
      publishData: false,
    });
  });
});

describe('RtcTokenSignerService', () => {
  it('signs a token that verifies back to the same claims', () => {
    const signer = signerWith();
    const input = signInput();

    const signed = signer.sign(input);
    const claims = signer.verify(signed.token);

    expect(claims.sub).toBe('user-123');
    expect(claims.pid).toBe('proj_1');
    expect(claims.rid).toBe('room_1');
    expect(claims.rnm).toBe('demo-room');
    expect(claims.env).toBe(Environment.PRODUCTION);
    expect(claims.perms).toEqual(input.permissions);
    expect(claims.aud).toBe('raven-rtc');
    expect(claims.iss).toBe('raven');
  });

  it('produces a three-part JWT', () => {
    const signed = signerWith().sign(signInput());
    expect(signed.token.split('.')).toHaveLength(3);
  });

  it('reports the expiry it signed', () => {
    const signed = signerWith().sign(signInput({ ttlSeconds: 600 }));
    const lifetimeMs = signed.expiresAt.getTime() - signed.issuedAt.getTime();
    expect(lifetimeMs).toBe(600_000);
    expect(signed.claims.exp - signed.claims.iat).toBe(600);
  });

  it('gives every token a distinct id', () => {
    const signer = signerWith();
    const a = signer.sign(signInput());
    const b = signer.sign(signInput());
    expect(a.tokenId).not.toBe(b.tokenId);
    expect(a.tokenId.startsWith('rtk_')).toBe(true);
  });

  describe('rejection paths', () => {
    it.each([
      ['an empty string', ''],
      ['a non-JWT string', 'not-a-token'],
      ['a two-part token', 'aaa.bbb'],
      ['a four-part token', 'aaa.bbb.ccc.ddd'],
    ])('rejects %s as INVALID_TOKEN', (_label, raw) => {
      expect(() => signerWith().verify(raw)).toThrow(
        expect.objectContaining({ code: 'INVALID_TOKEN' }),
      );
    });

    it('rejects a token signed with a different secret', () => {
      const signed = signerWith('secret-a').sign(signInput());
      expect(() => signerWith('secret-b').verify(signed.token)).toThrow(RtcTokenError);
    });

    it('rejects an expired token as TOKEN_EXPIRED, distinctly from invalid', () => {
      // A client whose token merely aged out must be told to refresh
      // (spec §21), not left guessing. Minted through the real signing
      // path with the clock wound back, so the signature is genuinely
      // valid and only the expiry is against it.
      const realNow = Date.now;
      Date.now = () => realNow() - 3_600_000;
      let expiredToken: string;
      try {
        expiredToken = signerWith().sign(signInput({ ttlSeconds: 60 })).token;
      } finally {
        Date.now = realNow;
      }

      expect(() => signerWith().verify(expiredToken)).toThrow(
        expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      );
    });

    it('rejects a tampered payload even though only the claims changed', () => {
      // The whole point of signing: a client that edits its own
      // permissions must be rejected, not obeyed (spec §38).
      const signer = signerWith();
      const signed = signer.sign(signInput());
      const forged = tamperPayload(signed.token, (claims) => {
        (claims.perms as Record<string, unknown>).publish = true;
      });

      expect(() => signer.verify(forged)).toThrow(
        expect.objectContaining({ code: 'INVALID_TOKEN' }),
      );
    });

    it('rejects a token whose project id was swapped', () => {
      const signer = signerWith();
      const signed = signer.sign(signInput());
      const forged = tamperPayload(signed.token, (claims) => {
        claims.pid = 'proj_someone_else';
      });

      expect(() => signer.verify(forged)).toThrow(RtcTokenError);
    });

    it('rejects a token whose environment was escalated to production', () => {
      const signer = signerWith();
      const signed = signer.sign(signInput({ environment: Environment.DEVELOPMENT }));
      const forged = tamperPayload(signed.token, (claims) => {
        claims.env = Environment.PRODUCTION;
      });

      expect(() => signer.verify(forged)).toThrow(RtcTokenError);
    });

    it('rejects a validly-signed token that is missing permissions', () => {
      // Structural completeness is checked after the signature, so this
      // only fires for tokens we minted: i.e. an older build's format.
      // "No perms" must not read as "grants nothing"; it must read as
      // "not a token".
      const signer = signerWith();
      const [header] = signer.sign(signInput()).token.split('.');
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          jti: 'rtk_x',
          sub: 'user-1',
          pid: 'proj_1',
          env: Environment.PRODUCTION,
          rid: 'room_1',
          rnm: 'demo',
          iat: now,
          exp: now + 600,
          aud: 'raven-rtc',
          iss: 'raven',
        }),
        'utf8',
      ).toString('base64url');
      const { createHmac } = require('crypto') as typeof import('crypto');
      const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');

      expect(() => signer.verify(`${header}.${payload}.${signature}`)).toThrow(
        expect.objectContaining({ code: 'INVALID_TOKEN' }),
      );
    });

    it('rejects a validly-signed token issued for a different audience', () => {
      // A chat token that somehow shared our secret must still not work.
      const signer = signerWith();
      const [header] = signer.sign(signInput()).token.split('.');
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          jti: 'ctk_x',
          sub: 'user-1',
          pid: 'proj_1',
          env: Environment.PRODUCTION,
          rid: 'room_1',
          rnm: 'demo',
          perms: resolvePermissions(permissions({ join: true })),
          iat: now,
          exp: now + 600,
          aud: 'raven-chat',
          iss: 'raven',
        }),
        'utf8',
      ).toString('base64url');
      const { createHmac } = require('crypto') as typeof import('crypto');
      const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');

      expect(() => signer.verify(`${header}.${payload}.${signature}`)).toThrow(
        expect.objectContaining({ code: 'INVALID_TOKEN' }),
      );
    });
  });
});
