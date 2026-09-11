import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { UnauthorizedError } from '../../shared/errors/app-error';

/**
 * Authenticates the Prometheus scrape target. A shared bearer secret,
 * same shape as SfuRegistrationGuard: this is a fleet-membership
 * credential ("I operate this deployment"), not a per-caller identity,
 * and there's nowhere to issue a scoped one from.
 *
 * Without this, GET /metrics leaks business volume (request counts by
 * route), the internal route map, and a live success/failure oracle to
 * anyone on the internet — see docs/RELEASE_READINESS_AUDIT.md.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  private readonly logger = new Logger(MetricsAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const expected = this.configService.get<string>('metrics.scrapeSecret');

    if (!expected) {
      // Never fail open. An unset secret means nobody can scrape, which
      // surfaces as a clear error to the operator's Prometheus, instead
      // of an open endpoint nobody notices.
      this.logger.error('METRICS_SCRAPE_SECRET is not configured — rejecting /metrics');
      throw new UnauthorizedError('Metrics scraping is not configured on this deployment');
    }

    if (!provided || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedError('Invalid metrics scrape credentials');
    }

    return true;
  }
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Hashed first so the comparison is over fixed-length inputs;
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * length oracle if the raw strings were passed straight in.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
