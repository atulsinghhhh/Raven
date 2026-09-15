import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ActivityActorType, ActivityEventType } from '../../activity-events.constants';

const EVENT_TYPES = Object.values(ActivityEventType);
const ACTOR_TYPES = Object.values(ActivityActorType);

/**
 * Every filter the Global Activity Explorer (§8) offers, mapped straight
 * onto `ActivityEventsService.list()`'s query shape. Validation-only: the
 * service itself re-applies its own `MAX_LIMIT`, so a bad actor hitting
 * this endpoint directly (not just through the dashboard) still can't ask
 * for more than 200 rows at once.
 */
export class QueryActivityDto {
  @ApiPropertyOptional({ description: 'Restrict to one developer, by their internal user id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  developerId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one project, by its internal id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ enum: EVENT_TYPES, description: 'Restrict to one event type.' })
  @IsOptional()
  @IsEnum(ActivityEventType)
  eventType?: ActivityEventType;

  @ApiPropertyOptional({ enum: ACTOR_TYPES, description: 'Restrict to one actor type.' })
  @IsOptional()
  @IsEnum(ActivityActorType)
  actorType?: ActivityActorType;

  @ApiPropertyOptional({ description: 'true for successful events only, false for failures only.' })
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' ? true : value === false || value === 'false' ? false : value,
  )
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({ description: 'Restrict to one IP address.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'Restrict to one request id.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  requestId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one resource, by its public id.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against actor email, resource id, or request id.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — events at or after this instant.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — events at or before this instant.' })
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
