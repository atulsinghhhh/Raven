import { ExecutionContext } from '@nestjs/common';
import { ForbiddenError } from '../errors/app-error';
import { ProjectOriginGuard } from './project-origin.guard';
import { ProjectOriginService } from './project-origin.service';

type Headers = Record<string, string | undefined>;

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function serviceAllowing(allowed: boolean): { service: ProjectOriginService; isAllowed: jest.Mock } {
  const isAllowed = jest.fn().mockResolvedValue(allowed);
  return { service: { isAllowed } as unknown as ProjectOriginService, isAllowed };
}

describe('ProjectOriginGuard', () => {
  it('takes the project from the verified RTC token, not from the request', async () => {
    // The tenancy guarantee: a caller cannot name the project whose
    // allow-list it is checked against.
    const { service, isAllowed } = serviceAllowing(true);
    const guard = new ProjectOriginGuard(service);

    await guard.canActivate(
      contextFor({
        headers: { origin: 'https://app-a.com' } satisfies Headers,
        rtcContext: { projectId: 'project-a' },
        // Present and deliberately ignored.
        body: { projectId: 'project-b' },
        query: { projectId: 'project-b' },
      }),
    );

    expect(isAllowed).toHaveBeenCalledWith('project-a', 'https://app-a.com');
  });

  it('takes the project from the chat actor when that is the credential', async () => {
    const { service, isAllowed } = serviceAllowing(true);
    const guard = new ProjectOriginGuard(service);

    await guard.canActivate(
      contextFor({
        headers: { origin: 'https://app-b.com' } satisfies Headers,
        chatActor: { projectId: 'project-b', kind: 'client' },
      }),
    );

    expect(isAllowed).toHaveBeenCalledWith('project-b', 'https://app-b.com');
  });

  it('allows the request when the policy allows the origin', async () => {
    const { service } = serviceAllowing(true);
    const guard = new ProjectOriginGuard(service);

    await expect(
      guard.canActivate(
        contextFor({ headers: { origin: 'https://app-a.com' }, rtcContext: { projectId: 'project-a' } }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects with a 403 naming the origin and where to fix it', async () => {
    // A CORS rejection is invisible to page JavaScript, so the whole point
    // of enforcing here is that the developer can read the reason.
    const { service } = serviceAllowing(false);
    const guard = new ProjectOriginGuard(service);

    const attempt = guard.canActivate(
      contextFor({ headers: { origin: 'https://evil.example' }, rtcContext: { projectId: 'project-a' } }),
    );

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attempt).rejects.toThrow(/https:\/\/evil\.example/);
    await expect(attempt).rejects.toThrow(/Allowed Origins/);
  });

  it('refuses when no credential has been authenticated yet', async () => {
    // Wired before the auth guard, this would otherwise check nothing at
    // all and silently pass everything. Failing loudly is the only safe
    // reading of that mistake.
    const { service, isAllowed } = serviceAllowing(true);
    const guard = new ProjectOriginGuard(service);

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(isAllowed).not.toHaveBeenCalled();
  });

  it('passes a missing Origin through to the policy rather than short-circuiting', async () => {
    // Server-side callers send no Origin. Whether that is acceptable is the
    // policy's decision, not the guard's.
    const { service, isAllowed } = serviceAllowing(true);
    const guard = new ProjectOriginGuard(service);

    await guard.canActivate(contextFor({ headers: {}, rtcContext: { projectId: 'project-a' } }));

    expect(isAllowed).toHaveBeenCalledWith('project-a', undefined);
  });
});
