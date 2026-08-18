import { Injectable, Logger } from '@nestjs/common';
import { WebhookEndpointStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { generateId } from '../../shared/utils/crypto.util';

/**
 * Event names Raven emits. Chat owns all of these today; the pipeline is
 * project-scoped so later phases (recording, streaming) publish through
 * the same machinery rather than inventing a second one (spec §31).
 */
export const WEBHOOK_EVENT_TYPES = [
  'message.created',
  'message.updated',
  'message.deleted',
  'reaction.added',
  'reaction.removed',
  'room.created',
  'participant.joined',
  'participant.left',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Records an event and queues one delivery row per subscribed endpoint.
 * That's all it does — the actual HTTP calls happen later, in
 * WebhookDeliveryWorker.
 *
 * This split is the point: the message path must never wait on a
 * developer's webhook endpoint (spec §32). `emit()` is called with `void`
 * from the chat services and swallows its own failures, so a webhook
 * problem can never fail a message that's already durably stored.
 */
@Injectable()
export class WebhookEventsService {
  private readonly logger = new Logger(WebhookEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(projectId: string, type: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { projectId, status: WebhookEndpointStatus.ACTIVE },
        select: { id: true, enabledEvents: true },
      });

      // Nothing subscribed: don't write an event row nobody will read.
      const subscribed = endpoints.filter(
        (endpoint) => endpoint.enabledEvents.length === 0 || endpoint.enabledEvents.includes(type),
      );
      if (subscribed.length === 0) {
        return;
      }

      await this.prisma.webhookEvent.create({
        data: {
          publicId: generateId('evt'),
          projectId,
          type,
          payload: payload as object,
          deliveries: {
            create: subscribed.map((endpoint) => ({ endpointId: endpoint.id })),
          },
        },
      });
    } catch (err) {
      this.logger.error(`failed to queue webhook event ${type}: ${(err as Error).message}`);
    }
  }
}
