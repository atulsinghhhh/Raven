import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CONNECTION_EVENT_TYPES } from '../observability.constants';

/**
 * The one shape every `@ravenkash/rtc` telemetry event takes: a flat
 * `type` plus a small free-form `data` bag, rather than one DTO per
 * event kind. `data` is intentionally loose (Phase 9 spec §4/§10): the
 * SDK attaches whatever developer-safe metadata is relevant to that
 * event (sdkVersion, platform, iceConnectionState, error code/message,
 * etc.) and the ingest service reads only the fields it recognizes.
 */
export class IngestEventDto {
  @ApiProperty({
    example: 'conn_01J8Z3K9QK2Y8V6ZC7B5R9F0XN',
    description: "The client-generated connection ID (Room's own, stable for its lifetime).",
  })
  @IsString()
  @Matches(/^conn_/, { message: 'connectionId must be a Livqeno connection ID (conn_...)' })
  @MaxLength(128)
  connectionId!: string;

  @ApiProperty({ enum: CONNECTION_EVENT_TYPES })
  @IsIn(CONNECTION_EVENT_TYPES)
  type!: (typeof CONNECTION_EVENT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Defaults to server receipt time if omitted.' })
  @IsOptional()
  @IsISO8601()
  timestamp?: string;

  @ApiPropertyOptional({
    description: 'Small, developer-safe metadata bag — never raw audio/video, never secrets.',
    example: { sdkVersion: '0.1.0', platform: 'web', browser: 'chrome' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
