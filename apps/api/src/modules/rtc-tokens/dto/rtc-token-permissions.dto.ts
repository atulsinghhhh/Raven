import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Raven's own permission vocabulary. The RTC Tokens service translates
 * this into a LiveKit VideoGrant — see rtc-tokens.service.ts. Keeping our
 * own names here (rather than exposing LiveKit's grant shape directly)
 * is what lets us swap the underlying SFU later without changing the
 * public API contract (docs/architecture/sfu-comparison.md).
 */
export class RtcTokenPermissionsDto {
  @ApiPropertyOptional({ default: true, description: 'Allowed to join the room at all' })
  @IsOptional()
  @IsBoolean()
  join?: boolean = true;

  @ApiPropertyOptional({ default: true, description: 'Allowed to subscribe to other participants\' tracks' })
  @IsOptional()
  @IsBoolean()
  subscribe?: boolean = true;

  @ApiPropertyOptional({ default: false, description: 'Allowed to publish any track at all' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Restricts publish to audio (microphone) — only meaningful when publish=true' })
  @IsOptional()
  @IsBoolean()
  publishAudio?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Restricts publish to video (camera) — only meaningful when publish=true' })
  @IsOptional()
  @IsBoolean()
  publishVideo?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Allowed to send/receive WebRTC data channel messages' })
  @IsOptional()
  @IsBoolean()
  publishData?: boolean = false;
}
