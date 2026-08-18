import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListMessagesDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from a previous page\'s nextCursor — walks backwards into history. Cursor-based, not offset-based, so pages stay stable while new messages arrive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  before?: string;

  @ApiPropertyOptional({
    description:
      'Opaque cursor that walks forward toward newer messages. This is how a client catches up on what it missed while disconnected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  after?: string;

  @ApiPropertyOptional({ description: 'Restrict to one thread, by the root message\'s public id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  threadRootId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one sender.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  senderId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Include soft-deleted messages as tombstones (no text). Useful for moderation views.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDeleted?: boolean;
}
