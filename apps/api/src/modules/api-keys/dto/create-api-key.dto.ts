import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @ApiPropertyOptional({ example: 'production-server' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
