import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

// Raven's own permission vocabulary — rtc-tokens.service.ts translates
// this into a LiveKit VideoGrant. Keeping our own names here instead of
// exposing LiveKit's grant shape means we could swap SFUs later without
// breaking the public API.
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
