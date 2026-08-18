import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength, MinLength } from 'class-validator';

// Conservative charset: alphanumeric, dash, underscore, dot. Avoids
// characters that are awkward or unsafe in URLs, logs, or as a LiveKit
// room name (which this value becomes verbatim in a later phase).
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
