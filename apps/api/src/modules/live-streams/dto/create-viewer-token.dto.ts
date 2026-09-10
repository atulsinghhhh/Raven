import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export class CreateViewerTokenDto {
  @ApiProperty({
    example: 'user-789',
    description:
      "The viewer's identity, from your own authenticated session — never trusted from an unauthenticated client. Always minted with subscribe-only RTC permissions; there is no field here that can request publish access.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(IDENTITY_PATTERN, { message: 'identity may only contain letters, numbers, "-", "_", and "."' })
  identity!: string;
}
