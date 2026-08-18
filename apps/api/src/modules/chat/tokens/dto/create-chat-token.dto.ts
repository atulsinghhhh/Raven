import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CHAT_SCOPES } from '../../chat-permissions';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class CreateChatTokenDto {
  @ApiProperty({
    example: 'user-123',
    description:
      "The end user this token speaks for. Everything they send is attributed to this identity — the browser can never override it.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, { message: 'userId may only contain letters, numbers, "-", "_", and "."' })
  userId!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    description:
      'Conversation references (conv_ id, uuid, or name) this token may touch. Omit to allow every conversation the user is a member of.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  conversations?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: CHAT_SCOPES,
    description:
      'Narrows the token below what the user\'s role allows. Can only ever remove permissions — listing "chat:manage" here does not grant it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(CHAT_SCOPES as unknown as string[], { each: true })
  scopes?: string[];

  @ApiPropertyOptional({
    example: 3600,
    minimum: 60,
    maximum: 21600,
    description:
      'Lifetime in seconds. Defaults to CHAT_TOKEN_DEFAULT_TTL_SECONDS, capped at CHAT_TOKEN_MAX_TTL_SECONDS. There is no non-expiring chat token.',
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(21600)
  ttlSeconds?: number;
}
