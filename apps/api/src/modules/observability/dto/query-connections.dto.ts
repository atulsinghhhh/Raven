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

  /**
   * A connection's `publicId` from the previous page's last row. Absent on
   * the first page. Never an internal database id — see the comment on
   * `ConnectionsService.getDetail` on why only the public id ever leaves
   * this service.
   */
  @ApiPropertyOptional({ description: "The previous page's last connection publicId. Omit for the first page." })
  @IsOptional()
  @IsString()
  cursor?: string;
}
