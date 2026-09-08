import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { OnboardingService } from './onboarding.service';

const STATE_EXAMPLE = {
  step: 3,
  completed: false,
  completedAt: null,
  useCases: ['saas', 'communication'],
  experienceLevel: 'some-experience',
  stack: ['react', 'nodejs'],
  createdFirstProject: false,
};

@ApiTags('Onboarding')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  @ApiOperation({
    summary: "The signed-in user's onboarding state",
    description: 'What the dashboard reads to resume the flow at the right step, or to skip it entirely once completed.',
  })
  @ApiResponse({ status: 200, schema: { example: STATE_EXAMPLE } })
  getState(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.getState(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Save onboarding progress',
    description: 'Every field optional, so each step persists just its own answer. `step` is what makes a closed tab resumable.',
  })
  @ApiResponse({ status: 200, schema: { example: STATE_EXAMPLE } })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOnboardingDto) {
    return this.onboardingService.update(user.id, dto);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark onboarding finished',
    description: 'Idempotent — completing twice keeps the original timestamp. After this the dashboard stops routing the user to /onboarding.',
  })
  @ApiResponse({ status: 200, schema: { example: { ...STATE_EXAMPLE, step: 7, completed: true, completedAt: '2026-09-08T12:00:00.000Z' } } })
  complete(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.complete(user.id);
  }
}
