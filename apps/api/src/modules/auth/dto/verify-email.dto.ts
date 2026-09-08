import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the link in the verification email.' })
  @IsString()
  // Bounded so a multi-megabyte body cannot reach the SHA-256 call. The
  // real token is 43 base64url characters.
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
