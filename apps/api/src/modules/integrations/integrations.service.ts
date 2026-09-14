import { Injectable } from '@nestjs/common';
import { ApiKeyStatus, Project, ProjectIntegration, UsageProduct } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ValidationFailedError } from '../../shared/errors/app-error';
import { ActivityActorType, ActivityEventType } from '../super-admin/activity-events.constants';
import { ActivityEventsService } from '../super-admin/activity-events.service';
import { DiagnosticsService } from '../observability/diagnostics.service';
import { SelectIntegrationDto } from './dto/select-integration.dto';

/** Dashboard-facing product ids (kebab-case, match the wizard's registry) → the Prisma enum. */
const PRODUCT_PARAM: Record<string, UsageProduct> = {
  rtc: UsageProduct.RTC,
  chat: UsageProduct.CHAT,
  'live-streaming': UsageProduct.LIVE_STREAMING,
};

export function parseProductParam(param: string): UsageProduct {
  const product = PRODUCT_PARAM[param];
  if (!product) {
    throw new ValidationFailedError(`Unknown product "${param}"`);
  }
  return product;
}

export interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  detail?: string;
}

export interface VerifyResult {
  success: boolean;
  checks: VerifyCheck[];
}

/**
 * Backs the quickstart page's integration wizard: persists the developer's
 * stack selection per product, and runs a real server-side check when they
 * click "Test your integration".
 *
 * Deliberately minimal state — see the `ProjectIntegration` model's doc
 * comment. "SDK installed" / "example copied" are never tracked here as
 * self-reported booleans; the dashboard infers those from real signals
 * (rooms/connections/messages/streams existing) the same way
 * `buildOnboardingSteps` already does for first-run onboarding.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly diagnostics: DiagnosticsService,
    private readonly activityEvents: ActivityEventsService,
  ) {}

  getAll(projectId: string): Promise<ProjectIntegration[]> {
    return this.prisma.projectIntegration.findMany({ where: { projectId } });
  }

  async select(
    project: Project,
    userId: string,
    product: UsageProduct,
    dto: SelectIntegrationDto,
  ): Promise<ProjectIntegration> {
    const row = await this.prisma.projectIntegration.upsert({
      where: { projectId_product: { projectId: project.id, product } },
      create: { projectId: project.id, product, language: dto.language, framework: dto.framework },
      update: { language: dto.language, framework: dto.framework },
    });

    void this.activityEvents.record({
      eventType: ActivityEventType.INTEGRATION_STACK_SELECTED,
      actorType: ActivityActorType.USER,
      actorId: userId,
      developerId: project.ownerId,
      projectId: project.id,
      resourceType: 'integration',
      resourceId: product,
      metadata: { product, language: dto.language, framework: dto.framework },
    }).catch(() => undefined); // Never blocks the wizard on a logging failure.

    return row;
  }

  /**
   * Runs the same checks a developer would otherwise have to eyeball across
   * the API Keys and Diagnostics pages, scoped to what the chosen product
   * actually needs. Every check is a real read — an active key existing, a
   * dependency answering — never a guess.
   */
  async verify(project: Project, userId: string, product: UsageProduct): Promise<VerifyResult> {
    const checks: VerifyCheck[] = [];

    const activeKeys = await this.prisma.apiKey.count({
      where: { projectId: project.id, status: ApiKeyStatus.ACTIVE },
    });
    checks.push(
      activeKeys > 0
        ? { id: 'apiKey', label: 'API credentials', status: 'pass' }
        : {
            id: 'apiKey',
            label: 'API credentials',
            status: 'fail',
            detail: 'No active API key for this project. Create one on the API Keys page.',
          },
    );

    const diagnostics = await this.diagnostics.getDiagnostics(project);

    if (product === UsageProduct.CHAT) {
      checks.push(
        diagnostics.dependencies.signaling === 'up'
          ? { id: 'signaling', label: 'Chat gateway', status: 'pass' }
          : { id: 'signaling', label: 'Chat gateway', status: 'fail', detail: 'The chat/signaling gateway is unreachable.' },
      );
    } else {
      checks.push(
        diagnostics.dependencies.sfu === 'up'
          ? { id: 'sfu', label: 'SFU (media plane)', status: 'pass' }
          : {
              id: 'sfu',
              label: 'SFU (media plane)',
              status: 'fail',
              detail: 'No healthy, reachable RTC server is registered. New rooms cannot be placed.',
            },
      );
      checks.push(
        diagnostics.dependencies.turn === 'up'
          ? { id: 'turn', label: 'TURN', status: 'pass' }
          : { id: 'turn', label: 'TURN', status: 'fail', detail: 'The TURN server is unreachable.' },
      );
    }

    const success = checks.every((c) => c.status === 'pass');

    await this.prisma.projectIntegration
      .updateMany({
        where: { projectId: project.id, product },
        data: { lastVerifiedAt: new Date(), lastVerifiedSuccess: success },
      })
      .catch(() => undefined); // No row yet (verified before selecting) — the check result still returns; nothing to persist against.

    void this.activityEvents.record({
      eventType: ActivityEventType.INTEGRATION_CONNECTION_TESTED,
      actorType: ActivityActorType.USER,
      actorId: userId,
      developerId: project.ownerId,
      projectId: project.id,
      resourceType: 'integration',
      resourceId: product,
      success,
      metadata: { product, checks },
    }).catch(() => undefined);
    void this.activityEvents.record({
      eventType: success ? ActivityEventType.INTEGRATION_CONNECTION_SUCCEEDED : ActivityEventType.INTEGRATION_CONNECTION_FAILED,
      actorType: ActivityActorType.USER,
      actorId: userId,
      developerId: project.ownerId,
      projectId: project.id,
      resourceType: 'integration',
      resourceId: product,
      success,
      metadata: { product },
    }).catch(() => undefined);

    return { success, checks };
  }
}
