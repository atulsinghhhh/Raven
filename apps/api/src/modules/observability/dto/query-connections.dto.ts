import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ConnectionState } from '../../../generated/prisma/client';

const STATES = Object.values(ConnectionState);

export class QueryConnectionsDto {
  @ApiPropertyOptional({ enum: STATES })
  @IsOptional()
  @IsIn(STATES)
  state?: ConnectionState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}
