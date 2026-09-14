import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ErrorCategory } from '../../../../generated/prisma/client';

const CATEGORIES = Object.values(ErrorCategory);

/**
 * Filters for the platform-wide grouped error view (spec §15). Unlike
 * `QueryErrorsDto` in observability (per-project, ungrouped rows), this
 * endpoint groups by `category` + `message` across every project, so
 * pagination applies to the *groups*, not the raw `ErrorEvent` rows.
 */
export class QueryGroupedErrorsDto {
  @ApiPropertyOptional({ enum: CATEGORIES, description: 'Restrict to one error category.' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: ErrorCategory;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
