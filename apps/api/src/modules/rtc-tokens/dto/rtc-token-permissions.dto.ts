import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

// Raven's own permission vocabulary. It is signed straight into the RTC
// token as `perms` and enforced by the signaling gateway: no translation
// into a third party's grant shape. Keeping the public names independent
// of whatever the media plane wants internally is what let Raven replace
// its SFU without breaking this contract, and it is why the SFU's own
// `room.Permissions` is a separate type, not this one reused.
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
