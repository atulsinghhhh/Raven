import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ConversationStatus } from '../../../../generated/prisma/client';

export class UpdateConversationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'name may only contain letters, numbers, "-", "_", and "."' })
  name?: string;

  @ApiPropertyOptional({ enum: Object.values(ConversationStatus) })
  @IsOptional()
  @IsIn(Object.values(ConversationStatus))
  status?: ConversationStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
