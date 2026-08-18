import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

/**
 * The request-shaped half of an audit entry: who was on the other end of
 * the connection, and which request it was.
 *
 * A decorator rather than reaching for the raw request inside services,
 * so services stay transport-agnostic and testable without a fake Request.
 */
export interface AuditContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Long enough to be useful, short enough that a hostile header cannot bloat a row. */
const MAX_USER_AGENT = 500;

export const AuditRequestContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const userAgent = request.headers['user-agent'];

    return {
      requestId: request.requestId,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, MAX_USER_AGENT) : undefined,
    };
  },
);
