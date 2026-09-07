import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * What an SFU reports on every heartbeat (spec §26).
 *
 * The load counters are required — a heartbeat that didn't carry them
 * would keep the node alive in the registry while leaving the allocator
 * with stale numbers, which is worse than no heartbeat at all. The
 * resource gauges are optional because a node that cannot read them (an
 * unusual container, a platform without the counters) should still be able
 * to say it is alive.
 */
export class RtcServerHeartbeatDto {
  @ApiProperty({ example: 12, description: 'Rooms this node is currently serving.' })
  @IsInt()
  @Min(0)
  activeRooms!: number;

  @ApiProperty({ example: 47, description: 'Participants currently connected across all of this node\'s rooms.' })
  @IsInt()
  @Min(0)
  activeParticipants!: number;

  @ApiPropertyOptional({ example: 34.2, description: 'CPU utilisation, 0-100.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cpuPercent?: number;

  @ApiPropertyOptional({ example: 61.8, description: 'Memory utilisation, 0-100.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  memoryPercent?: number;

  @ApiPropertyOptional({ example: 12_400_000, description: 'Inbound media throughput, bits per second.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  networkInBps?: number;

  @ApiPropertyOptional({ example: 48_900_000, description: 'Outbound media throughput, bits per second. Expected to exceed inbound in an SFU — one publisher feeds many subscribers.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  networkOutBps?: number;
}
