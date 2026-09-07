import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeController,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RegisterRtcServerDto } from './dto/register-rtc-server.dto';
import { RtcServerHeartbeatDto } from './dto/rtc-server-heartbeat.dto';
import { SfuRegistrationGuard } from './guards/sfu-registration.guard';
import { RtcServerRegistryService } from './rtc-server-registry.service';

/**
 * The SFU fleet's own endpoints — not part of the public developer API.
 *
 * Excluded from the published OpenAPI document on purpose: these are an
 * internal contract between Raven's control plane and Raven's media
 * plane, and documenting them alongside the developer-facing API would
 * invite applications to call them. The contract itself is documented in
 * docs/rtc/sfu.md, for whoever operates the fleet.
 */
@ApiTags('RTC Servers (internal)')
@ApiExcludeController()
@ApiBearerAuth('sfuRegistration')
@Controller('v1/rtc/servers')
@UseGuards(SfuRegistrationGuard)
export class RtcServersController {
  constructor(private readonly registry: RtcServerRegistryService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register this SFU node with the control plane',
    description:
      'Called on boot. Idempotent by name — a restarting node reclaims its existing row, and its load counters are reset, since a freshly booted node is serving nothing.',
  })
  @ApiResponse({ status: 201, description: 'Node registered and eligible for room allocation' })
  register(@Body() dto: RegisterRtcServerDto) {
    return this.registry.register(dto);
  }

  @Put(':name/heartbeat')
  @ApiOperation({
    summary: 'Report this node as alive, with its current load',
    description:
      'A node that stops heartbeating is marked unhealthy and stops receiving new allocations; its existing rooms keep running. A heartbeat from an unhealthy node promotes it back to healthy.',
  })
  @ApiResponse({ status: 200, description: 'Heartbeat recorded' })
  @ApiNotFoundResponse({ description: 'Unknown node — register first' })
  heartbeat(@Param('name') name: string, @Body() dto: RtcServerHeartbeatDto) {
    return this.registry.heartbeat(name, dto);
  }
}
