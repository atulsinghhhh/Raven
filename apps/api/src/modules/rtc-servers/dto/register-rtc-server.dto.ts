import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Same character class as participant identities: these end up in log
// lines, metric labels, and CLI arguments, so anything needing quoting or
// escaping is more trouble than it is worth.
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class RegisterRtcServerDto {
  @ApiProperty({
    example: 'sfu-asia-02',
    description:
      'Stable name for this node, unique across the fleet. Supplied by the node (SFU_NODE_ID) so a restart reclaims the same registry row instead of orphaning it.',
  })
  @MinLength(1)
  @MaxLength(128)
  @Matches(SERVER_NAME_PATTERN, {
    message: 'name may only contain letters, numbers, "-", "_", and "."',
  })
  name!: string;

  @ApiProperty({ example: 'asia-south', description: 'Region this node serves. Free-form; the allocator treats it as a preference.' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  region!: string;

  @ApiProperty({
    example: 'sfu-1.rtc.example.com',
    description: 'Host clients reach for media. Not the same as internalUrl inside a container network.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  publicHost!: string;

  @ApiProperty({
    example: 'http://sfu-1:7000',
    description: "Base URL the control plane uses for server-to-server calls to this node.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  internalUrl!: string;

  @ApiPropertyOptional({
    example: 100,
    default: 100,
    description:
      'Rooms this node advertises it can hold. A ceiling the allocator respects, not a target it aims for.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity: number = 100;

  @ApiPropertyOptional({ example: '0.1.0', description: 'Build identifier, so a fleet mid-rollout is legible.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;
}
