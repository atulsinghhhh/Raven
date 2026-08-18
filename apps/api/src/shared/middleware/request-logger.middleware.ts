import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

/**
 * One JSON line per request, tagged with a correlation ID.
 * Deliberately skips headers/bodies — those can carry API keys, JWTs,
 * passwords. This is the one log line guaranteed to fire for every
 * request no matter which handler (if any) ends up processing it.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      this.logger.log(
        JSON.stringify({
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs,
        }),
      );
    });

    next();
  }
}
