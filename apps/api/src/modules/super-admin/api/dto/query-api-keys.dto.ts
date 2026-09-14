import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiKeyStatus, Environment } from '../../../../generated/prisma/client';

/**
 * Filters for the platform-wide API key list (`GET /v1/super-admin/api/keys`).
 * Validation-only: `ApiOpsService.listKeys` re-applies its own limit cap, so
 * a bad actor hitting this endpoint directly can't ask for more than 200
 * rows at once regardless of what this DTO lets through.
 */
export class QueryApiKeysDto {
  @ApiPropertyOptional({ enum: ApiKeyStatus, description: 'Restrict to keys in this status.' })
  @IsOptional()
  @IsEnum(ApiKeyStatus)
  status?: ApiKeyStatus;

  @ApiPropertyOptional({ description: 'Restrict to one project, by its internal id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ enum: Environment, description: 'Restrict to keys minted for this environment.' })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — keys created at or after this instant.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — keys created at or before this instant.' })
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
