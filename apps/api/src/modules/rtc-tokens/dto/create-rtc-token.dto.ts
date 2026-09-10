import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { RtcTokenPermissionsDto } from './rtc-token-permissions.dto';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class CreateRtcTokenDto {
  @ApiProperty({
    example: 'user-123',
    minLength: 1,
    maxLength: 128,
    description: 'Unique within the room. Letters, numbers, "-", "_", "." only.',
  })
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, {
    message: 'participantIdentity may only contain letters, numbers, "-", "_", and "."',
  })
  participantIdentity!: string;

  @ApiPropertyOptional({ type: RtcTokenPermissionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RtcTokenPermissionsDto)
  permissions: RtcTokenPermissionsDto = new RtcTokenPermissionsDto();

  @ApiPropertyOptional({
    example: 600,
    minimum: 30,
    maximum: 21600,
    description:
      'Token lifetime in seconds. Defaults to RTC_TOKEN_DEFAULT_TTL_SECONDS. There is no way to request a non-expiring token — every RTC token is short-lived by design.',
  })
  @IsOptional()
  @IsInt()
  @Min(30, { message: 'ttlSeconds must be at least 30 seconds' })
  @Max(21600, { message: 'ttlSeconds must be at most 21600 seconds (6 hours)' })
  ttlSeconds?: number;

  @ApiPropertyOptional({ example: '{"displayName":"Alice"}', maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  metadata?: string;
}
