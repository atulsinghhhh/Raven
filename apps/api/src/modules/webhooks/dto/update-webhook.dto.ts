import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { WebhookEndpointStatus } from '../../../generated/prisma/client';
import { WEBHOOK_EVENT_TYPES } from '../webhook-events.service';

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @ApiPropertyOptional({ type: [String], enum: WEBHOOK_EVENT_TYPES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsIn(WEBHOOK_EVENT_TYPES as unknown as string[], { each: true })
  events?: string[];

  @ApiPropertyOptional({
    enum: Object.values(WebhookEndpointStatus),
    description: 'Set back to ACTIVE to re-enable an endpoint Raven auto-disabled after repeated failures.',
  })
  @IsOptional()
  @IsIn(Object.values(WebhookEndpointStatus))
  status?: WebhookEndpointStatus;
}
