import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RoomStatus } from '../../../../generated/prisma/enums';

const STATUSES = Object.values(RoomStatus);

/**
 * Filters for the platform-wide room list (`GET /v1/super-admin/rtc/rooms`).
 * Unlike the developer-facing `QueryConnectionsDto`/`QueryConnectionsDto`
 * siblings, this one is never implicitly scoped to a project — `projectId`
 * here is an optional filter, not the route's identity, since the whole
 * point of this surface is seeing across every project at once.
 */
export class QueryRtcRoomsDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Restrict to one room status.' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: RoomStatus;

  @ApiPropertyOptional({ description: 'Restrict to one project, by its internal id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — rooms created at or after this instant.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — rooms created at or before this instant.' })
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
