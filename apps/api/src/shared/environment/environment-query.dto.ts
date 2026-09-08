import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DEFAULT_ENVIRONMENT, Environment } from './environment.constants';

/**
 * The environment selector for dashboard/CLI routes, where the caller is a
 * logged-in developer instead of an API key.
 *
 * Only ever mixed into JWT-authenticated routes. On an API-key route the
 * environment comes from the key and a caller-supplied value would be a
 * privilege escalation: a development key naming `PRODUCTION` and being
 * believed.
 */
export class EnvironmentQueryDto {
  @ApiPropertyOptional({
    enum: Environment,
    default: DEFAULT_ENVIRONMENT,
    description: 'Which environment to act in. Defaults to development.',
  })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}

/** Optional filter: omitted means "every environment", for console-wide views. */
export class EnvironmentFilterDto {
  @ApiPropertyOptional({
    enum: Environment,
    description: 'Restrict results to one environment. Omit to see all of them.',
  })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}
