import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

/** The project resolved by ApiKeyAuthGuard from the request's API key. */
export const CurrentProjectId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.apiProjectId!;
  },
);
