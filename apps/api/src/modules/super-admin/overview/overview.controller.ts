import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { OverviewResponse, OverviewService } from './overview.service';

/**
 * The first thing a Raven operator sees on landing in the Super Admin
 * Portal (spec §4/§5). Read-only: no `@RequirePlatformRole(...)`, so any
 * of the four platform roles (including READ_ONLY) can load it.
 */
@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/overview')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  @ApiOperation({
    summary: 'Platform-wide operations dashboard',
    description:
      'Aggregate counts across developers, projects, RTC, chat, live streaming and infrastructure health. Every field is a real query against existing tables — nothing here is a fabricated or hardcoded number.',
  })
  getOverview(): Promise<OverviewResponse> {
    return this.overview.getOverview();
  }
}
