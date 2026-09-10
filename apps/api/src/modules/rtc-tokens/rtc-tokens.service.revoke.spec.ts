import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { Environment, ProjectScope } from '../../shared/environment/environment.constants';
import { RoomsService } from '../rooms/rooms.service';
import { UsageAllowanceService } from '../usage/usage-allowance.service';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { RtcTokenRevocationService } from './rtc-token-revocation.service';
import { RtcTokenSignerService } from './rtc-token-signer.service';
import { RtcTokensService } from './rtc-tokens.service';

const SCOPE: ProjectScope = { projectId: 'project-a', environment: Environment.DEVELOPMENT };

/**
 * `revoke` only touches the rooms service, Prisma and the revocation store,
 * so the signer/config/usage collaborators are present purely to satisfy
 * the constructor.
 */
function makeService(opts: {
  /** What `roomsService.findOneForProject` does — throwing models a room outside the scope. */
  roomLookup?: jest.Mock;
  /** What `prisma.rtcToken.findFirst` returns. */
  token?: { id: string; expiresAt: Date } | null;
}) {
  const findFirst = jest.fn().mockResolvedValue(opts.token ?? null);
  const prisma = { rtcToken: { findFirst } } as unknown as PrismaService;

  const findOneForProject = opts.roomLookup ?? jest.fn().mockResolvedValue({ id: 'room-1', name: 'room-one' });
  const rooms = { findOneForProject } as unknown as RoomsService;

  const revoke = jest.fn().mockResolvedValue(undefined);
  const revocations = { revoke } as unknown as RtcTokenRevocationService;

  const service = new RtcTokensService(
    prisma,
    rooms,
    { get: jest.fn() } as unknown as ConfigService,
    {} as unknown as RtcTokenSignerService,
    {} as unknown as UsageAllowanceService,
    revocations,
  );

  return { service, findFirst, findOneForProject, revoke };
}

describe('revoke', () => {
  it('revokes a token for the caller’s own project', async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    const { service, revoke } = makeService({ token: { id: 'tok-1', expiresAt } });

    const result = await service.revoke(SCOPE, 'room-1', 'tok-1');

    expect(result).toEqual({ id: 'tok-1', revoked: true, expiresAt });
    expect(revoke).toHaveBeenCalledWith('tok-1', expiresAt);
  });

  it('checks the room belongs to the project and environment first', async () => {
    // The room lookup is what enforces environment isolation: rtc_tokens
    // carries no environment column of its own.
    const roomLookup = jest.fn().mockRejectedValue(new NotFoundError('Room', RavenErrorCode.ROOM_NOT_FOUND));
    const { service, findFirst, revoke } = makeService({
      roomLookup,
      token: { id: 'tok-1', expiresAt: new Date(Date.now() + 600_000) },
    });

    await expect(service.revoke(SCOPE, 'room-1', 'tok-1')).rejects.toBeInstanceOf(NotFoundError);
    // Nothing is looked up or killed under a room that isn't the caller's.
    expect(findFirst).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('scopes the token lookup by project and room, not by id alone', async () => {
    // Otherwise a token id leaked from another tenant would be revocable
    // by anybody holding any key.
    const { service, findFirst } = makeService({
      token: { id: 'tok-1', expiresAt: new Date(Date.now() + 600_000) },
    });

    await service.revoke(SCOPE, 'room-1', 'tok-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok-1', roomId: 'room-1', projectId: 'project-a' },
      }),
    );
  });

  it('reports another project’s token as not found rather than forbidden', async () => {
    // A 403 would confirm the token id exists somewhere, which is an
    // enumeration oracle across tenants.
    const { service, revoke } = makeService({ token: null });

    await expect(service.revoke(SCOPE, 'room-1', 'someone-elses-token')).rejects.toBeInstanceOf(NotFoundError);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('is idempotent: revoking twice succeeds both times', async () => {
    // The endpoint is retried, and the tombstone is a plain SET.
    const expiresAt = new Date(Date.now() + 600_000);
    const { service } = makeService({ token: { id: 'tok-1', expiresAt } });

    await expect(service.revoke(SCOPE, 'room-1', 'tok-1')).resolves.toMatchObject({ revoked: true });
    await expect(service.revoke(SCOPE, 'room-1', 'tok-1')).resolves.toMatchObject({ revoked: true });
  });
});
