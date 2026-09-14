import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LiveStreamStatus } from '../../../../generated/prisma/enums';

const STATUSES = Object.values(LiveStreamStatus);

/**
 * Filters for `GET /v1/super-admin/live/streams` (spec §12) — a
 * platform-wide, cross-project view, unlike `DashboardLiveStreamsController`
 * which is always scoped to one `projectId` from the route. Here `projectId`
 * is an optional filter instead of a path segment.
 */
export class QueryLiveStreamsDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Restrict to one lifecycle status.' })
  @IsOptional()
  @IsEnum(LiveStreamStatus)
  status?: LiveStreamStatus;

  @ApiPropertyOptional({ description: 'Restrict to one project, by its internal id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — streams created at or after this instant.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — streams created at or before this instant.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
