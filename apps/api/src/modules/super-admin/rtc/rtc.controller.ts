import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryRtcRoomsDto } from './dto/query-rtc-rooms.dto';
import { RtcService } from './rtc.service';

/**
 * Platform-wide RTC operations console (spec §10). Unlike
 * `DashboardObservabilityController`/`DashboardRtcServersController` (both
 * scoped to one developer's own project or to fleet metadata with no
 * project data at all), every route here spans every project on the
 * deployment — that's this slice's entire reason to exist.
 *
 * No `@RequirePlatformRole`: this is a read-only surface, so any
 * authenticated platform admin (SUPER_ADMIN, ADMIN, SUPPORT, READ_ONLY) can
 * use it, same reasoning as `ActivityController`.
 */
@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/rtc')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class RtcController {
  constructor(private readonly rtc: RtcService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide RTC overview — active rooms/participants, RTC minutes, SFU health, and more' })
  @ApiQuery({ name: 'range', required: false, enum: ['15m', '1h', '24h', '7d', '30d', '90d'] })
  getOverview(@Query('range') range?: string) {
    return this.rtc.getOverview(range);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Paginated list of rooms across every project on the platform' })
  listRooms(@Query() query: QueryRtcRoomsDto) {
    return this.rtc.listRooms(query);
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: 'One room — its project/developer, SFU assignment, and its participants' })
  @ApiNotFoundResponse({ description: 'No room with this id' })
  getRoom(@Param('id') id: string) {
    return this.rtc.getRoomDetail(id);
  }

  @Get('participants/:id')
  @ApiOperation({ summary: 'One participant — its connection history and RTC tokens' })
  @ApiNotFoundResponse({ description: 'No participant with this id' })
  getParticipant(@Param('id') id: string) {
    return this.rtc.getParticipantDetail(id);
  }
}
