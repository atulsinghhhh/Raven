import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import {
  DEFAULT_ENVIRONMENT,
  ProjectScope,
} from '../../../shared/environment/environment.constants';

/**
 * The project *and* environment an API-key-authenticated request may act
 * in, both resolved by ApiKeyAuthGuard from the key itself.
 *
 * Prefer this over `@CurrentProjectId()` for anything that reads or writes
 * project data. Passing a bare project id into a query that should also be
 * environment-scoped is the exact mistake that lets a development key
 * reach production rows, and it is invisible at a call site where both
 * arguments are strings.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProjectScope => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return {
      projectId: request.apiProjectId!,
      // Keys predating environments have no column value of their own in
      // memory only if the guard did not run; the DB default covers the rest.
      environment: request.apiEnvironment ?? DEFAULT_ENVIRONMENT,
    };
  },
);
