import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ONBOARDING_MAX_STEP, ONBOARDING_MIN_STEP } from '../onboarding.service';

/**
 * Free-form-ish on purpose: the option lists live in the dashboard, and
 * adding a use case there shouldn't require an API deploy. The API only
 * bounds size and shape — except experience level, whose four values are
 * stable enough to pin.
 */
export class UpdateOnboardingDto {
  @IsOptional()
  @IsInt()
  @Min(ONBOARDING_MIN_STEP)
  @Max(ONBOARDING_MAX_STEP)
  step?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  useCases?: string[];

  @IsOptional()
  @IsIn(['getting-started', 'some-experience', 'experienced', 'production'])
  experienceLevel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  stack?: string[];

  @IsOptional()
  @IsBoolean()
  createdFirstProject?: boolean;
}
