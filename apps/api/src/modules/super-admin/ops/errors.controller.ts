import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { QueryGroupedErrorsDto } from './dto/query-grouped-errors.dto';
import { ErrorsService } from './errors.service';

/**
 * Platform-wide error explorer (spec §15). Read-only, no
 * `@RequirePlatformRole(...)`: every platform role, including READ_ONLY,
 * can see it — the same "read is unrestricted, mutation is gated"
 * convention Overview/Activity already use.
 */
@ApiTags('Super Admin — Errors')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/errors')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class ErrorsController {
  constructor(private readonly errors: ErrorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Errors grouped by category + message, across every project',
    description:
      'Each row is one recurring error signature: how many times it fired, first/last seen, and how many distinct projects and developers it touched. Real groupBy over ErrorEvent — nothing sampled or invented.',
  })
  list(@Query() query: QueryGroupedErrorsDto) {
    return this.errors.listGrouped(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One error event, with its project and connection' })
  @ApiNotFoundResponse({ description: 'No error event with this id' })
  getOne(@Param('id') id: string) {
    return this.errors.getDetail(id);
  }
}
