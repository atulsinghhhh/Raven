import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { DashboardWsTokensController } from './dashboard-ws-tokens.controller';
import { DashboardWsTokenService, IssuedDashboardWsToken } from './tokens/dashboard-ws-token.service';

const USER: AuthenticatedUser = { id: 'user-1', email: 'dev@example.com', jti: 'jti-1', exp: 0 };

function makeController(
  overrides: {
    authorize?: jest.Mock;
    issue?: jest.Mock;
  } = {},
) {
  const authorize = overrides.authorize ?? jest.fn().mockResolvedValue({ project: {}, role: 'OWNER' });
  const issue =
    overrides.issue ??
    jest.fn().mockReturnValue({
      token: 'signed-token',
      tokenId: 'dwt_1',
      userId: USER.id,
      projectId: 'project-1',
      expiresAt: new Date(),
      wsUrl: 'wss://api.example.com/v1/dashboard/ws',
    } satisfies IssuedDashboardWsToken);

  const projectsService = { authorize } as unknown as ProjectsService;
  const tokens = { issue } as unknown as DashboardWsTokenService;
  return { controller: new DashboardWsTokensController(tokens, projectsService), authorize, issue };
}

describe('DashboardWsTokensController', () => {
  it('requires an authenticated session (JwtAuthGuard applied at the class level)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardWsTokensController) as unknown[] | undefined;
    expect(guards).toContain(JwtAuthGuard);
  });

  it('authorizes the caller for the project before minting a token', async () => {
    const { controller, authorize, issue } = makeController();

    await controller.create(USER, 'project-1');

    expect(authorize).toHaveBeenCalledWith('project-1', USER.id, Capability.ProjectRead);
    // Authorization runs first: a token must never be signed ahead of the
    // capability check succeeding.
    const authorizeOrder = authorize.mock.invocationCallOrder[0];
    const issueOrder = issue.mock.invocationCallOrder[0];
    expect(authorizeOrder).toBeLessThan(issueOrder);
  });

  it('never mints a token when the caller is not a project member', async () => {
    const authorize = jest.fn().mockRejectedValue(new NotFoundError('Project'));
    const { controller, issue } = makeController({ authorize });

    await expect(controller.create(USER, 'project-1')).rejects.toThrow(NotFoundError);
    expect(issue).not.toHaveBeenCalled();
  });

  it('never mints a token when the caller lacks the capability', async () => {
    const authorize = jest.fn().mockRejectedValue(new ForbiddenError());
    const { controller, issue } = makeController({ authorize });

    await expect(controller.create(USER, 'project-1')).rejects.toThrow(ForbiddenError);
    expect(issue).not.toHaveBeenCalled();
  });

  it('returns exactly what the token service issued', async () => {
    const { controller } = makeController();
    const result = await controller.create(USER, 'project-1');
    expect(result).toMatchObject({ token: 'signed-token', projectId: 'project-1' });
  });

  it('mints the token for the project in the URL, never a client-supplied one', async () => {
    const { controller, issue } = makeController();
    await controller.create(USER, 'project-1');
    expect(issue).toHaveBeenCalledWith({ projectId: 'project-1', userId: USER.id });
  });
});
