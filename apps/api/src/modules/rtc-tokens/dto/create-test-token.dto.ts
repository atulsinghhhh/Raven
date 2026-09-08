import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

// No permissions/ttlSeconds fields on purpose: a dashboard test token
// always gets the same fixed, short-lived, full-publish grant (see
// dashboard-rtc-tokens.controller.ts). Real tokens for a developer's app
// go through the API-key-guarded endpoint instead.
export class CreateTestTokenDto {
  @ApiPropertyOptional({
    example: 'test-user',
    default: 'dashboard-test-user',
    minLength: 1,
    maxLength: 128,
  })
  @IsOptional()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, {
    message: 'participantIdentity may only contain letters, numbers, "-", "_", and "."',
  })
  participantIdentity?: string;
}
