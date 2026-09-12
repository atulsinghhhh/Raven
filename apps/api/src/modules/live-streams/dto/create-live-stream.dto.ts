import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LiveStreamDeliveryMode, LiveStreamVisibility } from '../../../generated/prisma/client';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const VISIBILITY_VALUES = Object.values(LiveStreamVisibility);
const DELIVERY_MODE_VALUES = Object.values(LiveStreamDeliveryMode);

export class CreateLiveStreamDto {
  @ApiProperty({ example: 'Friday Q&A', minLength: 1, maxLength: 200 })
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: 'user-123',
    description:
      "The developer's own identity for whoever is starting this stream. Registered as its HOST — the only identity a stream is created with, and the only one whose role is ever HOST rather than CO_HOST.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, { message: 'hostIdentity may only contain letters, numbers, "-", "_", and "."' })
  hostIdentity!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'A URL you host — Livqeno does not accept or store thumbnail uploads.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  thumbnailUrl?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 'en', maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @ApiPropertyOptional({ enum: VISIBILITY_VALUES, default: LiveStreamVisibility.PUBLIC })
  @IsOptional()
  @IsIn(VISIBILITY_VALUES)
  visibility?: LiveStreamVisibility;

  @ApiPropertyOptional({
    description: 'Your own JSON, capped at 4 KB — same convention as Room/Conversation metadata.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'When set, the stream is created for a future start — see docs/live-streaming/overview.md#scheduled-streams. Livqeno does not automatically transition status at this time; your backend still calls start().',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    enum: DELIVERY_MODE_VALUES,
    default: LiveStreamDeliveryMode.RTC_ONLY,
    description:
      'RTC_ONLY (default): viewers get an RTC credential and join the room, same as today. BROADCAST: the ' +
      "audience never joins the RTC room — createViewerToken is refused; use GET .../playback instead once " +
      "the stream is started and egress reports ready.",
  })
  @IsOptional()
  @IsIn(DELIVERY_MODE_VALUES)
  deliveryMode?: LiveStreamDeliveryMode;
}
