import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuditAction } from '../audit.constants';

const ACTIONS = Object.values(AuditAction);

export class QueryAuditLogsDto {
  @ApiPropertyOptional({ enum: ACTIONS, description: 'Restrict to one action.' })
  @IsOptional()
  @IsIn(ACTIONS)
  action?: string;

  @ApiPropertyOptional({ description: 'Restrict to actions taken by one user.' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one resource, by its public id.' })
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
