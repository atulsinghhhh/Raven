import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAllowedOriginsDto {
  /**
   * The complete list, not a delta: a PATCH that replaced only some entries
   * would make "remove this origin" impossible to express.
   *
   * Each entry must be a bare origin — scheme, host and optionally a port.
   * Paths, query strings and wildcards are rejected with the offending
   * entries named, rather than silently coerced into something that would
   * never match. Values are stored normalized, so `https://APP.com/` and
   * `https://app.com` are the same entry.
   */
  @ApiProperty({
    example: ['https://app.example.com', 'https://example.com'],
    description: 'Complete list of allowed browser origins. Empty means unconfigured, which allows any origin.',
  })
  @IsArray()
  // Generous, but bounded: this list is consulted on every telemetry event
  // and every WebSocket upgrade, and an unbounded one is a foot-gun.
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedOrigins!: string[];

  @ApiPropertyOptional({
    default: true,
    description:
      'Allow http(s)://localhost, 127.0.0.1 and [::1] on any port regardless of the list above. On by default so configuring production origins never breaks local development.',
  })
  @IsOptional()
  @IsBoolean()
  allowLocalhostOrigins?: boolean;
}
