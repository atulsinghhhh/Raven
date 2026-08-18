import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

// A permissive but bounded MIME check — enough to reject obvious junk and
// header-injection attempts, without maintaining an allow-list that would
// break the first time someone uploads a format we didn't think of.
const MIME_PATTERN = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;

export class CreateAttachmentDto {
  @ApiProperty({ example: 'design-review.png', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(255)
  @Matches(MIME_PATTERN, { message: 'mimeType must look like "type/subtype"' })
  mimeType!: string;

  @ApiProperty({
    example: 184320,
    description:
      'Declared size in bytes, checked against STORAGE_MAX_ATTACHMENT_BYTES before a URL is issued.',
  })
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024)
  size!: number;

  @ApiPropertyOptional({ description: 'API-key callers only — ignored for browser chat tokens.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  uploaderId?: string;

  @ApiPropertyOptional({ description: 'Developer-owned JSON, e.g. image dimensions.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
