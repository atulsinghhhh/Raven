import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';

/**
 * Authenticates an SFU node to the control plane (spec §38).
 *
 * A shared bearer secret rather than a per-node credential, deliberately:
 * nodes are created by the deployment, not by an operator clicking
 * "add server", so there is nowhere for a per-node secret to be issued
 * *from* without inventing a provisioning step the architecture explicitly
 * avoids. The secret is a fleet-membership credential — holding it means
 * "I am part of this deployment's media plane" — and it is scoped to
 * exactly two endpoints (register, heartbeat), neither of which can read
 * project data or mint client credentials.
 *
 * It must differ from RTC_TOKEN_SECRET, which env validation enforces in
 * production: a client token key is held by anything that mints tokens,
 * and that is a much wider blast radius than the media fleet.
 */
@Injectable()
export class SfuRegistrationGuard implements CanActivate {
  private readonly logger = new Logger(SfuRegistrationGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const expected = this.configService.get<string>('sfu.registrationSecret');

    if (!expected) {
      // Never fail open. An unset secret in a non-production deploy still
      // means nobody can register — which surfaces as a clear error at the
      // node, rather than an open endpoint nobody notices.
      this.logger.error('SFU_REGISTRATION_SECRET is not configured — rejecting SFU registration');
      throw new UnauthorizedError('SFU registration is not configured on this deployment');
    }

    if (!provided || !constantTimeEquals(provided, expected)) {
      this.logger.warn(`SFU registration rejected from ${request.ip ?? 'unknown'}`);
      throw new UnauthorizedError('Invalid SFU registration credentials');
    }

    return true;
  }
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Hashed first so the comparison is over fixed-length inputs —
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * length oracle if the raw strings were passed straight in.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
