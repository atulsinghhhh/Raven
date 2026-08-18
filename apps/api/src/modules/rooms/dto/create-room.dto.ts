import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength, MinLength } from 'class-validator';

// Alphanumeric + dash/underscore/dot only — keeps this safe to use
// verbatim as a LiveKit room name, in URLs, and in logs.
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
}
