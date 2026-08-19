import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class LeaveStreamDto {
  @ApiProperty({ example: 'user-789' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, { message: 'identity may only contain letters, numbers, "-", "_", and "."' })
  identity!: string;
}
