import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query for the usage detail endpoints. Both fields are capped rather than
 * paginated — see USAGE_HISTORY_MAX_LIMIT in usage.constants.ts.
 *
 * The bounds are numeric literals, not the constants they mirror, and that
 * is deliberate: `scripts/docs-groundtruth.mjs` reads these decorators with
 * a regex to generate the REST reference, and it only understands literals.
 * Written as `@Max(USAGE_HISTORY_MAX_LIMIT)` the generated docs say
 * "1–∞" while the API returns 400 for 201 — the exact drift the generated
 * reference exists to prevent. Every other DTO in this API writes literals
 * for the same reason.
 *
 * query-usage.dto.spec.ts asserts these bounds equal the constants, so the
 * duplication cannot rot silently.
 */
export class QueryUsageDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'How many history rows to return, newest first.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 365,
    default: 30,
    description: 'How many UTC days of the daily rollup to return, including today.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
