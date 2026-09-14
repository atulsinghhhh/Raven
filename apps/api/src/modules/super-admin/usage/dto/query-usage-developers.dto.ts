import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query for `GET /v1/super-admin/usage/developers` (spec §14) — the
 * platform-wide, per-developer usage list. Mirrors the pagination shape
 * `QueryUsageDto`/`QueryActivityDto` already use elsewhere in the API:
 * numeric limit/offset, capped rather than page-token based, since the
 * underlying query is a straightforward `User` scan with no cursor state
 * worth maintaining.
 */
export class QueryUsageDevelopersDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against the developer email.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Only include developers with at least one product at or above 90% of its allowance (the same flag the row itself carries).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value))
  @IsBoolean()
  atRisk?: boolean;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
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
