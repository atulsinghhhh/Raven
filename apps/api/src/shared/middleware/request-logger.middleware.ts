import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Structured, one-line-per-request logging with a correlation ID.
 * Never logs headers or bodies — those routinely carry API keys, JWTs, and
 * passwords, and this line is the one thing guaranteed to run for every
 * request regardless of which handler (or none) processes it.
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
