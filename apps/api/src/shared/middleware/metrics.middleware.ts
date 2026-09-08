import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from '../../modules/metrics/metrics.service';

/**
 * RED metrics (rate, errors, duration) for the HTTP surface only;
 * WebSocket traffic (chat, signaling) never passes through Express
 * middleware/Nest's HTTP pipeline the same way, so those have their own
 * gauges in MetricsService instead.
 *
 * A middleware, not an interceptor: Nest's pipeline runs
 * Guards → Interceptors → Pipes → Handler, so an interceptor's
 * `intercept()` never even executes for a request a Guard rejects
 * (RateLimitGuard's 429s, auth guards' 401s): the exact error-rate
 * cases RED metrics exist to catch would be invisible. Middleware runs
 * ahead of all of that (same reasoning as RequestLoggerMiddleware,
 * which this mirrors), so it fires for every request that reaches
 * routing, no matter which guard/handler (if any) ends up rejecting it.
 *
 * The route label is the Express route *pattern*
 * (`req.baseUrl + req.route.path`, e.g. `/v1/rooms/:id`), never the raw
 * URL: a raw URL would put every distinct room/message id into its own
 * Prometheus label value, and unbounded label cardinality is exactly
 * what turns a metrics endpoint into an incident.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    // 'finish' fires once the response is actually sent, on both success
    // and error paths: after Nest's exception filter has set the real
    // status code. Reading res.statusCode any earlier would record every
    // failure as whatever it was before the filter ran.
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      // req.route is only set once Express matches a route: a 404
      // never gets one, and falling back to req.url there would
      // reintroduce the same cardinality problem for anything unmatched.
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      this.metrics.recordHttpRequest(req.method, route, res.statusCode, durationSeconds);
    });

    next();
  }
}
