import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ChatMemberRole, ConversationType } from '../../../../generated/prisma/client';

// Same character set as RTC room names: a conversation name shows up in
// URLs, logs, and `chat.connect({ room: "..." })`, so keep it boring.
const CONVERSATION_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class ConversationMemberDto {
  @ApiProperty({ example: 'user-123', maxLength: 128 })
  @MinLength(1)
  @MaxLength(128)
  @IsString()
  userId!: string;

  @ApiPropertyOptional({ enum: Object.values(ChatMemberRole), default: ChatMemberRole.MEMBER })
  @IsOptional()
  @IsIn(Object.values(ChatMemberRole))
  role?: ChatMemberRole;
}

export class CreateConversationDto {
  @ApiProperty({
    example: 'support-room-42',
    description: 'Unique within the project. Doubles as a human-readable handle for chat.connect({ room }).',
  })
  @MinLength(1)
  @MaxLength(128)
  @Matches(CONVERSATION_NAME_PATTERN, {
    message: 'name may only contain letters, numbers, "-", "_", and "."',
  })
  name!: string;

  @ApiPropertyOptional({
    enum: Object.values(ConversationType),
    default: ConversationType.CHANNEL,
    description:
      'Defaults to ROOM when roomId is set and to CHANNEL otherwise, but an explicit value here always wins — ' +
      'e.g. a DIRECT conversation can still be attached to a room to give a 1:1 call a chat panel.',
  })
  @IsOptional()
  @IsIn(Object.values(ConversationType))
  type?: ConversationType;

  @ApiPropertyOptional({
    description: 'Attach this conversation to an existing RTC room, giving that video call a chat panel.',
  })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3650,
    description: 'Overrides CHAT_RETENTION_DAYS for this conversation.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;

  @ApiPropertyOptional({
    type: [ConversationMemberDto],
    maxItems: 100,
    description:
      'IMPORTANT: a conversation created with no members is unreadable and unwritable by every client chat ' +
      'token, including one minted for whoever "created" it — a project API key is not itself a chat user, ' +
      'so there is no creator identity to add automatically. List every userId that should be able to ' +
      'connect here (or call addMember() for each of them before minting their token).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ConversationMemberDto)
  members?: ConversationMemberDto[];

  @ApiPropertyOptional({ description: 'Arbitrary developer-owned JSON. Size-capped like message metadata.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    default: false,
    description:
      'When true, a name collision returns the existing conversation instead of a 409 — including when two ' +
      'callers race to create the same named conversation concurrently, which the normal "everyone joins by ' +
      'conversation name" flow does on the very first try. Off by default so a genuine duplicate-name ' +
      'mistake still fails loudly. `members` is ignored on the fetched-existing path — use addMember() to ' +
      'add anyone to a conversation that already exists.',
  })
  @IsOptional()
  @IsBoolean()
  getOrCreate?: boolean;
}
