import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEFAULT_ENVIRONMENT, Environment } from '../../../shared/environment/environment.constants';

export class CreateApiKeyDto {
  @ApiPropertyOptional({ example: 'production-server' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    enum: Environment,
    default: DEFAULT_ENVIRONMENT,
    description:
      'Which environment this key may act in. Omitted means development — a key should never reach production because someone forgot to say otherwise.',
  })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}
