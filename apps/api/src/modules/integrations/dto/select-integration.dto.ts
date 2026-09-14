import { IsString, MaxLength } from 'class-validator';

/**
 * Free-form on purpose, same reasoning as `UpdateOnboardingDto`: the
 * language/framework option lists live in the dashboard's integration
 * registry, and adding a new framework there shouldn't require an API
 * deploy. The API only bounds shape and size.
 */
export class SelectIntegrationDto {
  @IsString()
  @MaxLength(32)
  language!: string;

  @IsString()
  @MaxLength(32)
  framework!: string;
}
