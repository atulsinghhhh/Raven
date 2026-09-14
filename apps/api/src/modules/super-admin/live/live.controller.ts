import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryLiveStreamsDto } from './dto/query-live-streams.dto';
import { LiveOverviewResponse, LiveService, LiveStreamDetail, LiveStreamPage } from './live.service';

/**
 * Platform-wide Live Streaming operations (spec §12) — every `LiveStream`
 * across every project, read-only. No `@RequirePlatformRole(...)` on any
 * route here: this is an observability surface, not a mutation, so all
 * four platform roles (including READ_ONLY) can use it, matching
 * `OverviewController` and `ActivityController`.
 */
@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/live')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Live Streaming operations overview',
    description:
      'Active streams, streams today, total/peak viewers (via peakViewerCount), ended-stream durations today, and failed streams (LiveStreamEgress.status = FAILED). Every field is a real query against existing tables.',
  })
  getOverview(): Promise<LiveOverviewResponse> {
    return this.live.getOverview();
  }

  @Get('streams')
  @ApiOperation({
    summary: 'List live streams across every project, newest first',
    description: 'Paginated. Filterable by status, project, and created-at range.',
  })
  listStreams(@Query() query: QueryLiveStreamsDto): Promise<LiveStreamPage> {
    return this.live.listStreams(query);
  }

  @Get('streams/:id')
  @ApiOperation({
    summary: 'One stream in full detail',
    description:
      "Includes hosts/co-hosts with roles, egress status and playback URL when the stream is BROADCAST mode, the linked chat conversation id, and the stream's room/RTC server region when set.",
  })
  getStream(@Param('id') id: string): Promise<LiveStreamDetail> {
    return this.live.getStream(id);
  }
}
