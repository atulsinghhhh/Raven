import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

// Alphanumeric + dash/underscore/dot only: keeps this safe to use
// verbatim in URLs, in log lines, and on the signaling wire.
const ROOM_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class CreateRoomDto {
  @ApiProperty({
    example: 'support-room-42',
    minLength: 1,
    maxLength: 128,
    description: 'Unique within the project (not globally). Letters, numbers, "-", "_", "." only.',
  })
  @MinLength(1)
  @MaxLength(128)
  @Matches(ROOM_NAME_PATTERN, {
    message: 'name may only contain letters, numbers, "-", "_", and "."',
  })
  name!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'When true, a name collision returns the existing room instead of a 409 — including when two ' +
      'callers race to create the same named room concurrently, which the normal "everyone joins by ' +
      'room name" flow does on the very first try. Off by default so a genuine duplicate-name mistake ' +
      'still fails loudly.',
  })
  @IsOptional()
  @IsBoolean()
  getOrCreate?: boolean;
}
