import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LiveStreamHostRole } from '../../../generated/prisma/client';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const ROLE_VALUES = Object.values(LiveStreamHostRole);

export class AddHostDto {
  @ApiProperty({ example: 'user-456' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, { message: 'identity may only contain letters, numbers, "-", "_", and "."' })
  identity!: string;

  @ApiPropertyOptional({
    enum: ROLE_VALUES,
    default: LiveStreamHostRole.CO_HOST,
    description:
      'HOST and CO_HOST get identical RTC/chat grants — the difference is bookkeeping, not permissions. A stream already has a HOST (set at creation); this is normally CO_HOST.',
  })
  @IsOptional()
  @IsIn(ROLE_VALUES)
  role?: LiveStreamHostRole;
}
