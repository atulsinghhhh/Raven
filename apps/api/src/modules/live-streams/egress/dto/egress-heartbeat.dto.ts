import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EgressHeartbeatDto {
  @IsString()
  @MinLength(1)
  streamId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  workerId!: string;

  @IsBoolean()
  hostConnected!: boolean;

  @IsBoolean()
  ffmpegAlive!: boolean;

  @IsBoolean()
  manifestReachable!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  playbackUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string;
}
