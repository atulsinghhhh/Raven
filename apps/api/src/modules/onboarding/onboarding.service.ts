import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

/** The dashboard-facing shape. Dates travel as ISO strings via JSON. */
export interface OnboardingState {
  step: number;
  completed: boolean;
  completedAt: Date | null;
  useCases: string[];
  experienceLevel: string | null;
  stack: string[];
  createdFirstProject: boolean;
}

/** The two fields every login/register response carries. */
export interface OnboardingStatus {
  completed: boolean;
  step: number;
}

export const ONBOARDING_MIN_STEP = 1;
export const ONBOARDING_MAX_STEP = 7;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the row a fresh account resumes from. Idempotent, and never
   * regresses: an upsert with an empty update, so calling it for an
   * account that is mid-onboarding (or done) changes nothing.
   */
  async ensureStarted(userId: string): Promise<void> {
    await this.prisma.userOnboarding.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * A user with no row reads as "not started" rather than erroring —
   * the migration backfilled completed rows for everyone who predates
   * onboarding, so a missing row is an account created outside the normal
   * flows (a seed script), and sending it through onboarding is honest.
   */
  async getState(userId: string): Promise<OnboardingState> {
    const row = await this.prisma.userOnboarding.findUnique({ where: { userId } });
    return {
      step: row?.step ?? ONBOARDING_MIN_STEP,
      completed: Boolean(row?.completedAt),
      completedAt: row?.completedAt ?? null,
      useCases: row?.useCases ?? [],
      experienceLevel: row?.experienceLevel ?? null,
      stack: row?.stack ?? [],
      createdFirstProject: row?.createdFirstProject ?? false,
    };
  }

  async getStatus(userId: string): Promise<OnboardingStatus> {
    const row = await this.prisma.userOnboarding.findUnique({
      where: { userId },
      select: { step: true, completedAt: true },
    });
    return { completed: Boolean(row?.completedAt), step: row?.step ?? ONBOARDING_MIN_STEP };
  }

  /**
   * Saves progress. Every field is optional so each onboarding step can
   * persist just its own answer — that's what makes the flow resumable
   * after a closed tab: `step` records where to pick back up.
   */
  async update(userId: string, dto: UpdateOnboardingDto): Promise<OnboardingState> {
    const data = {
      ...(dto.step !== undefined ? { step: dto.step } : {}),
      ...(dto.useCases !== undefined ? { useCases: dto.useCases } : {}),
      ...(dto.experienceLevel !== undefined ? { experienceLevel: dto.experienceLevel } : {}),
      ...(dto.stack !== undefined ? { stack: dto.stack } : {}),
      ...(dto.createdFirstProject !== undefined ? { createdFirstProject: dto.createdFirstProject } : {}),
    };

    await this.prisma.userOnboarding.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.getState(userId);
  }

  /** Idempotent, like markEmailVerified(): the second call keeps the
   *  original timestamp instead of quietly rewriting when it happened. */
  async complete(userId: string): Promise<OnboardingState> {
    await this.prisma.userOnboarding.upsert({
      where: { userId },
      create: { userId, completedAt: new Date(), step: ONBOARDING_MAX_STEP },
      update: {},
    });
    await this.prisma.userOnboarding.updateMany({
      where: { userId, completedAt: null },
      data: { completedAt: new Date(), step: ONBOARDING_MAX_STEP },
    });

    return this.getState(userId);
  }
}
