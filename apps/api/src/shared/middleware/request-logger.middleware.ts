import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { resolveRequestId } from './request-id.util';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

/**
 * One JSON line per request, tagged with a correlation ID.
 * Deliberately skips headers/bodies: those can carry API keys, JWTs,
 * passwords. This is the one log line guaranteed to fire for every
 * request no matter which handler (if any) ends up processing it.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    // Reuses the caller's x-request-id when it is well formed, so a
    // developer can trace one call across their logs and ours.
    const requestId = resolveRequestId(req.headers['x-request-id']);
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      this.logger.log({
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
      });
    });

    next();
  }
}
