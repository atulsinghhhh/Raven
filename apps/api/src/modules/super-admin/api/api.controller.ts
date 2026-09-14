import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { ActivityEventPage } from '../activity-events.service';
import { QueryActivityDto } from '../activity/dto/query-activity.dto';
import { ApiKeyListPage, ApiOpsService, ApiOverviewResponse } from './api.service';
import { QueryApiKeysDto } from './dto/query-api-keys.dto';

/**
 * Platform-wide API operations — every project's API keys, in one place.
 * No `@RequirePlatformRole`: every route here is read-only, so any
 * authenticated platform admin (SUPER_ADMIN, ADMIN, SUPPORT, READ_ONLY)
 * can see it, same convention `ActivityController` uses.
 *
 * There is no per-request log table in this codebase — see the doc
 * comment on `ApiOverviewResponse` in `./api.service.ts`. This controller
 * deliberately does not fabricate request volume, latency, or
 * status-code-breakdown endpoints to match the original spec's wishlist;
 * it exposes only what `ApiKey` and `ActivityEvent` actually record.
 */
@ApiTags('Super Admin')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/api')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class ApiController {
  constructor(private readonly apiOps: ApiOpsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'API key lifecycle stats, platform-wide — real ApiKey/ActivityEvent counts only',
    description:
      'No per-request log table exists yet, so this cannot report request volume, success/failure rates, ' +
      '4xx/5xx breakdowns, latency, or top endpoints/projects/developers. It reports what is real: key counts ' +
      'from ApiKey, and API-related ActivityEvent counts (key created/revoked, failed requests, rate-limit triggers).',
  })
  async overview(): Promise<ApiOverviewResponse> {
    return this.apiOps.getOverview();
  }

  @Get('keys')
  @ApiOperation({
    summary: "Every project's API keys, paginated — never includes secretHash or the raw secret",
    description:
      'Joined to Project and its owner so a row reads as "which project, whose key" without a second lookup. ' +
      'Same field discipline as the per-project ApiKeysController: publicId/name/environment/status/timestamps only.',
  })
  async keys(@Query() query: QueryApiKeysDto): Promise<ApiKeyListPage> {
    return this.apiOps.listKeys(query);
  }

  @Get('activity')
  @ApiOperation({
    summary: 'API-related ActivityEvent rows: API_KEY_CREATED, API_KEY_REVOKED, API_REQUEST_FAILED, RATE_LIMIT_TRIGGERED',
    description:
      'Secondary view. Reuses the Global Activity Explorer\'s QueryActivityDto for its filter shape, but rejects ' +
      'any eventType outside this domain\'s four API-related types. Omitting eventType merges all four, ' +
      'newest first, rather than widening the filter to every event type that exists.',
  })
  async activity(@Query() query: QueryActivityDto): Promise<ActivityEventPage> {
    return this.apiOps.listApiActivity({
      eventType: query.eventType,
      projectId: query.projectId,
      success: query.success,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
