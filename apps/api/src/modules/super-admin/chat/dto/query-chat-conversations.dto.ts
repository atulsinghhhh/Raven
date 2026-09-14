import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ConversationStatus, ConversationType } from '../../../../generated/prisma/enums';

const STATUSES = Object.values(ConversationStatus);
const TYPES = Object.values(ConversationType);

/**
 * Filters for the platform-wide conversation list (spec §11) — every
 * conversation across every project, not scoped to one like
 * `DashboardChatController`'s equivalent. `limit` is re-capped at 200 in
 * `ChatService.listConversations` regardless of what's requested here, so
 * a direct hit on this endpoint can't ask for an unbounded page.
 */
export class QueryChatConversationsDto {
  @ApiPropertyOptional({ description: 'Restrict to one project, by its internal id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

  @ApiPropertyOptional({ description: 'Case-insensitive substring match against the conversation name.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
