import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ActivityEventPage, ActivityEventQuery, ActivityEventsService } from '../activity-events.service';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryActivityDto } from './dto/query-activity.dto';

@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/activity')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class ActivityController {
  constructor(private readonly activityEvents: ActivityEventsService) {}

  @Get()
  @ApiOperation({
    summary: 'Global Activity Explorer — every ActivityEvent across the platform, newest first',
    description:
      'No @RequirePlatformRole: any authenticated platform admin (SUPER_ADMIN, ADMIN, SUPPORT, READ_ONLY) can read this — ' +
      'it is a read surface, not a mutation. Filters map straight onto ActivityEventsService.list(); the service itself caps ' +
      'limit at 200 regardless of what is requested here.',
  })
  async list(@Query() query: QueryActivityDto): Promise<ActivityEventPage> {
    const serviceQuery: ActivityEventQuery = {
      developerId: query.developerId,
      projectId: query.projectId,
      eventType: query.eventType,
      actorType: query.actorType,
      success: query.success,
      ipAddress: query.ipAddress,
      requestId: query.requestId,
      resourceId: query.resourceId,
      search: query.search,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    };

    return this.activityEvents.list(serviceQuery);
  }
}
