import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Lowercase on the wire, uppercase in the database. The SDK never sees a
// Prisma enum, and adding a type later doesn't break existing clients
// (spec §7).
export const MESSAGE_TYPE_VALUES = ['text', 'system', 'event', 'attachment'] as const;

export class SendMessageDto {
  @ApiPropertyOptional({
    example: 'Hello everyone!',
    description: 'Required for text messages. Length capped by CHAT_MAX_TEXT_LENGTH.',
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    enum: MESSAGE_TYPE_VALUES,
    default: 'text',
    description: '"system" and "event" are server-only — a browser chat token cannot send them.',
  })
  @IsOptional()
  @IsIn(MESSAGE_TYPE_VALUES as unknown as string[])
  type?: string;

  @ApiPropertyOptional({
    example: 'msg_9WcQ4kRz1nB2xYtL',
    description: 'Public id of the message being replied to. Must be in the same conversation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  replyTo?: string;

  @ApiPropertyOptional({
    example: 'client_123',
    description:
      'Idempotency key. Retrying a send with the same key returns the original message instead of creating a duplicate — which is what makes a reconnect-and-retry safe.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientMessageId?: string;

  @ApiPropertyOptional({ description: 'Public id of an already-uploaded attachment (att_...).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  attachmentId?: string;

  @ApiPropertyOptional({ description: 'Developer-owned JSON. Capped by CHAT_MAX_METADATA_BYTES.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'API-key callers only: the user this message is attributed to. Ignored for browser chat tokens, which always send as the token subject.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  senderId?: string;

  @ApiPropertyOptional({
    description:
      'Client send timestamp (epoch ms), used only for latency measurement. Never trusted as createdAt — the server stamps that.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  clientSentAt?: number;
}
