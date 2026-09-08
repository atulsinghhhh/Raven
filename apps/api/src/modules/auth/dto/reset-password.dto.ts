import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the link in the password-reset email.' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  // Same bounds as RegisterDto — 72 is bcrypt's input limit, not a
  // stylistic choice.
  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  password!: string;
}
