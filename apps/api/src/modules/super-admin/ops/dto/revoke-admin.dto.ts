import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RevokeAdminDto {
  @ApiProperty({ description: 'Why this admin is losing platform access. Required.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
