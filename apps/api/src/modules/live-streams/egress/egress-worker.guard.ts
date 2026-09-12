import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';

/**
 * Authenticates the standalone egress-worker service to the control plane's
 * internal heartbeat endpoint. Same shared-bearer-secret shape and same
 * reasoning as `SfuRegistrationGuard`: the worker is deployment
 * infrastructure, not a per-tenant credential holder, so there is no
 * per-worker credential to issue instead. Scoped to exactly one endpoint
 * (`POST /internal/egress/heartbeat`), which can only ever write onto
 * `LiveStreamEgress` rows — it cannot read project data or mint client
 * credentials.
 */
@Injectable()
export class EgressWorkerGuard implements CanActivate {
  private readonly logger = new Logger(EgressWorkerGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const expected = this.configService.get<string>('egress.workerSharedSecret');

    if (!expected) {
      this.logger.error('EGRESS_WORKER_SHARED_SECRET is not configured — rejecting egress-worker heartbeat');
      throw new UnauthorizedError('Egress-worker callbacks are not configured on this deployment');
    }

    if (!provided || !constantTimeEquals(provided, expected)) {
      this.logger.warn(`Egress-worker heartbeat rejected from ${request.ip ?? 'unknown'}`);
      throw new UnauthorizedError('Invalid egress-worker credentials');
    }

    return true;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
