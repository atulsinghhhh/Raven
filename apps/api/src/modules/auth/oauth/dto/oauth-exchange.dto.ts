import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OAuthExchangeDto {
  /** The authorization code from the provider's callback query string. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;

  /** The state value issued by the matching /start call. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  state!: string;
}
