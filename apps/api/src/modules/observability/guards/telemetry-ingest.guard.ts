import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import {
  RtcTokenVerifierService,
  VerifiedRtcToken,
} from '../../signaling/authentication/rtc-token-verifier.service';

export type TelemetryRequest = Request & { rtcContext?: VerifiedRtcToken };

/**
 * Authenticates telemetry ingestion with the same RTC token the browser
 * already holds for its own connection: no separate telemetry
 * credential to mint, store, or leak. See docs/telemetry.md#authentication.
 */
@Injectable()
export class TelemetryIngestGuard implements CanActivate {
  constructor(private readonly tokenVerifier: RtcTokenVerifierService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TelemetryRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    try {
      request.rtcContext = await this.tokenVerifier.verify(token ?? '');
    } catch {
      // Never forward the verifier's own error detail: this endpoint is
      // reachable by any RTC client, so it gets the same generic message
      // every other auth failure in this API returns.
      throw new UnauthorizedError('Invalid or expired RTC token');
    }

    return true;
  }
}
