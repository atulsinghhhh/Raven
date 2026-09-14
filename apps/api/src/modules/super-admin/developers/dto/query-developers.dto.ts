import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccountStatus } from '../../../../generated/prisma/enums';

const STATUSES = Object.values(AccountStatus);

/**
 * Sortable columns are limited to plain `User` fields. "Last active" and
 * "risk" both require cross-table aggregation (latest `ActivityEvent`,
 * failed-login counts) to compute at all, and doing that for every row of
 * every possible sort order would mean materialising the whole table on
 * every request. They're still returned on every row (§5's directory
 * columns), just not sortable in this pass — a documented scope cut, not
 * an oversight.
 */
const SORT_FIELDS = ['name', 'email', 'createdAt', 'status'] as const;
export type DeveloperSortField = (typeof SORT_FIELDS)[number];

export class QueryDevelopersDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against name or email.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: STATUSES, description: 'Restrict to one account status.' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: AccountStatus;

  @ApiPropertyOptional({ description: 'Only developers whose account was created on/after this ISO date.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Only developers whose account was created on/before this ISO date.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: DeveloperSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
