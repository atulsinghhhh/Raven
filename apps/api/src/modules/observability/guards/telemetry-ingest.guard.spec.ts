import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { RtcTokenVerifierService } from '../../signaling/authentication/rtc-token-verifier.service';
import { TelemetryIngestGuard, TelemetryRequest } from './telemetry-ingest.guard';

function contextWithHeader(authorization?: string): ExecutionContext {
  const request: Partial<TelemetryRequest> = { headers: { authorization } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TelemetryIngestGuard', () => {
  let verifier: { verify: jest.Mock };
  let guard: TelemetryIngestGuard;

  beforeEach(() => {
    verifier = { verify: jest.fn() };
    guard = new TelemetryIngestGuard(verifier as unknown as RtcTokenVerifierService);
  });

  it('attaches the verified RTC context to the request and allows the call through', async () => {
    const verified = {
      participantId: 'alice',
      projectId: 'p1',
      roomId: 'r1',
      roomName: 'demo',
      permissions: {},
      expiresAt: new Date(),
    };
    verifier.verify.mockResolvedValue(verified);

    const context = contextWithHeader('Bearer real-token');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('real-token');
    expect((context.switchToHttp().getRequest() as TelemetryRequest).rtcContext).toBe(verified);
  });

  it("rejects with a generic UnauthorizedError, never the verifier's internal error message", async () => {
    verifier.verify.mockRejectedValue(new Error('jose: signature verification failed: some internal detail'));

    const context = contextWithHeader('Bearer bad-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(guard.canActivate(context)).rejects.not.toMatchObject({
      message: expect.stringContaining('jose'),
    });
  });

  it('rejects a request with no Authorization header at all, without throwing a raw TypeError', async () => {
    verifier.verify.mockRejectedValue(new Error('Missing RTC token'));

    const context = contextWithHeader(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifier.verify).toHaveBeenCalledWith('');
  });
});
