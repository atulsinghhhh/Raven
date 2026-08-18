import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Intentionally has no `permissions`/`ttlSeconds` fields — a dashboard test
 * token always gets a fixed, short-lived, full-publish grant (see
 * dashboard-rtc-tokens.controller.ts). Real participant tokens for a
 * developer's own app are minted by their backend via the API-key-guarded
 * endpoint (rtc-tokens.controller.ts), not this one.
 */
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
