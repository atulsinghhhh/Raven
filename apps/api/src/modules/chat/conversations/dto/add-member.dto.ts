import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ChatMemberRole } from '../../../../generated/prisma/client';

export class AddMemberDto {
  @ApiProperty({ example: 'user-123', description: "Your own user identity string — Livqeno never owns end-user accounts." })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  userId!: string;

  @ApiPropertyOptional({ enum: Object.values(ChatMemberRole), default: ChatMemberRole.MEMBER })
  @IsOptional()
  @IsIn(Object.values(ChatMemberRole))
  role?: ChatMemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
