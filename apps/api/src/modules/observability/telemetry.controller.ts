import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { ConnectionsService } from './connections.service';
import { CurrentTelemetryContext } from './decorators/current-telemetry-context.decorator';
import { IngestEventDto } from './dto/ingest-event.dto';
import { TelemetryIngestGuard } from './guards/telemetry-ingest.guard';
import { VerifiedRtcToken } from '../signaling/authentication/rtc-token-verifier.service';

/**
 * The Telemetry API from the Phase 9 architecture diagram: the one
 * ingestion point `@corvidhq/rtc` best-effort POSTs connection/participant/
 * error events to. Authenticated by the same RTC token the browser
 * already holds (see TelemetryIngestGuard), never a separate credential.
 * Deliberately tolerant: malformed individual events fail this one
 * request, but the SDK never lets that affect the RTC connection itself
 * (Phase 9 spec §11): see docs/telemetry.md#reliability.
 */
@ApiTags('Telemetry')
@ApiBearerAuth('rtcToken')
@Controller('v1/telemetry')
@UseGuards(TelemetryIngestGuard)
export class TelemetryController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit(600)
  @ApiOperation({ summary: 'Best-effort ingestion of one RTC connection/participant/error event' })
  @ApiResponse({ status: 204, description: 'Event recorded' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async ingest(@CurrentTelemetryContext() ctx: VerifiedRtcToken, @Body() dto: IngestEventDto): Promise<void> {
    await this.connectionsService.recordEvent(ctx, dto);
  }
}
