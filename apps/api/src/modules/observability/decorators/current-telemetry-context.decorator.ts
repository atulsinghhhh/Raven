import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { VerifiedRtcToken } from '../../signaling/authentication/rtc-token-verifier.service';
import { TelemetryRequest } from '../guards/telemetry-ingest.guard';

export const CurrentTelemetryContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): VerifiedRtcToken => {
    const request = ctx.switchToHttp().getRequest<TelemetryRequest>();
    return request.rtcContext!;
  },
);
