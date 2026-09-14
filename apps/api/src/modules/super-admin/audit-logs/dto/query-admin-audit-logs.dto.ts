import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AdminAction, AdminTargetType } from '../../admin-audit.constants';

const ACTIONS = Object.values(AdminAction);
const TARGET_TYPES = Object.values(AdminTargetType);

/**
 * Mirrors `QueryAuditLogsDto` (the project-scoped sibling) in style, but
 * maps onto `AdminAuditService.list()`'s wider filter set — this log spans
 * the whole platform, not one project, so it also supports a date range
 * and pagination offset.
 */
export class QueryAdminAuditLogsDto {
  @ApiPropertyOptional({ description: 'Restrict to admin actions taken by one platform admin, by user id.' })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional({ enum: ACTIONS, description: 'Restrict to one admin action.' })
  @IsOptional()
  @IsIn(ACTIONS)
  action?: string;

  @ApiPropertyOptional({ enum: TARGET_TYPES, description: 'Restrict to one target type.' })
  @IsOptional()
  @IsIn(TARGET_TYPES)
  targetType?: string;

  @ApiPropertyOptional({ description: 'Restrict to one target, by its id.' })
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Entries recorded at or after this instant.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Entries recorded at or before this instant.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
