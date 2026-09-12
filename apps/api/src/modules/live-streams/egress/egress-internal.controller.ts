import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { EgressHeartbeatDto } from './dto/egress-heartbeat.dto';
import { EgressControlService } from './egress-control.service';
import { EgressWorkerGuard } from './egress-worker.guard';

/**
 * Not part of the public developer-facing API surface (see
 * `LiveStreamsController`'s own doc comment) — this is the standalone
 * egress-worker service's callback path, authenticated by a shared
 * deployment secret rather than a project API key. Excluded from the
 * Swagger document for the same reason `SfuRegistrationController`'s
 * endpoints are: a developer integrating against Livqeno never calls this.
 */
@ApiExcludeController()
@Controller('internal/egress')
@UseGuards(EgressWorkerGuard)
export class EgressInternalController {
  constructor(private readonly egressControl: EgressControlService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(@Body() dto: EgressHeartbeatDto): Promise<void> {
    await this.egressControl.recordHeartbeat(dto);
  }
}
