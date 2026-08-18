import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { DEFAULT_ENVIRONMENT, Environment } from '../../../shared/environment/environment.constants';
import { WEBHOOK_EVENT_TYPES } from '../webhook-events.service';

export class CreateWebhookDto {
  @ApiProperty({
    example: 'https://api.example.com/raven/webhooks',
    description: 'Must be https:// in production. Loopback/private addresses are rejected outside local dev.',
  })
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: WEBHOOK_EVENT_TYPES,
    description: 'Omit or leave empty to receive every event type.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsIn(WEBHOOK_EVENT_TYPES as unknown as string[], { each: true })
  events?: string[];

  @ApiPropertyOptional({
    enum: Environment,
    default: DEFAULT_ENVIRONMENT,
    description:
      'Which environment this endpoint receives events for. Endpoints are never cross-environment: a staging endpoint must not receive production traffic.',
  })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}
