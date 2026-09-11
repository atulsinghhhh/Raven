import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RtcServerRegistryService } from './rtc-server-registry.service';

/**
 * Dashboard/CLI view of the RTC fleet (spec §29 "Servers", §37).
 *
 * Guarded by developer session JWT and on purpose *not* project-scoped:
 * an RTC server is deployment-level infrastructure shared by every
 * project, so there is no project whose membership could authorize it.
 * That also means it exposes no project data: only node identity, health
 * and aggregate load, so any authenticated developer of this deployment
 * seeing it leaks nothing about anyone else's rooms.
 */
@ApiTags('Dashboard — RTC Servers')
@ApiBearerAuth('jwt')
@Controller('v1/rtc/servers')
@UseGuards(JwtAuthGuard)
export class DashboardRtcServersController {
  constructor(private readonly registry: RtcServerRegistryService) {}

  @Get()
  @ApiOperation({
    summary: 'List the RTC server fleet',
    description:
      "Load figures are a snapshot from each node's last heartbeat, not live truth — read them alongside lastHeartbeatAt.",
  })
  @ApiQuery({ name: 'region', required: false, description: 'Filter to one region' })
  @ApiResponse({ status: 200, description: 'Fleet inventory with per-node health and load' })
  list(@Query('region') region?: string) {
    return this.registry.list(region);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Fleet-wide RTC totals for the dashboard overview' })
  @ApiResponse({ status: 200, description: 'Server counts by health, plus aggregate rooms/participants/capacity' })
  metrics() {
    return this.registry.getFleetMetrics();
  }

  @Get(':name')
  @ApiOperation({ summary: 'One RTC server' })
  @ApiResponse({ status: 200, description: 'Node identity, health, load and capacity' })
  @ApiNotFoundResponse({ description: 'No node registered under this name' })
  get(@Param('name') name: string) {
    return this.registry.findByName(name);
  }

  @Post(':name/drain')
  @ApiOperation({
    summary: 'Stop sending new rooms to this node',
    description:
      'For upgrades and investigations. Existing rooms keep running and drain naturally as calls end — this never disconnects anyone.',
  })
  @ApiResponse({ status: 200, description: 'Node is draining' })
  @ApiNotFoundResponse({ description: 'No node registered under this name' })
  drain(@Param('name') name: string) {
    return this.registry.setDraining(name, true);
  }

  @Post(':name/undrain')
  @ApiOperation({ summary: 'Put a drained node back into the allocation pool' })
  @ApiResponse({ status: 200, description: 'Node is accepting allocations again' })
  @ApiNotFoundResponse({ description: 'No node registered under this name' })
  undrain(@Param('name') name: string) {
    return this.registry.setDraining(name, false);
  }
}
