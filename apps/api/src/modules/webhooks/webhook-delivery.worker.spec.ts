import { WebhookEndpointStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { Environment } from '../../shared/environment/environment.constants';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';

const CONFIG: Record<string, number> = {
  'webhooks.maxAttempts': 6,
  'webhooks.timeoutMs': 5000,
  'webhooks.backoffBaseMs': 10_000,
  'webhooks.disableAfterConsecutiveFailures': 3,
};

function delivery(overrides: { attempts?: number; consecutiveFailures?: number } = {}) {
  return {
    id: 'del-1',
    attempts: overrides.attempts ?? 0,
    event: {
      publicId: 'evt_1',
      type: 'message.created',
      payload: { text: 'hi' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      projectId: 'project-1',
      environment: Environment.PRODUCTION,
    },
    endpoint: {
      id: 'ep-row-1',
      publicId: 'whe_abc',
      projectId: 'project-1',
      url: 'https://example.com/hook',
      signingSecret: 'whsec_test',
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
    },
  };
}

function makeWorker() {
  const prisma = {
    webhookDelivery: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    webhookEndpoint: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue(undefined),
  };
  const redisService = { client: { set: jest.fn(), get: jest.fn(), del: jest.fn() } };
  const configService = { get: (key: string) => CONFIG[key] };
  const dashboardEvents = { publish: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyProject: jest.fn().mockResolvedValue(undefined) };

  const worker = new WebhookDeliveryWorker(
    prisma as unknown as PrismaService,
    redisService as unknown as RedisService,
    configService as never,
    dashboardEvents as unknown as DashboardEventsService,
    notifications as unknown as NotificationsService,
  );

  const attempt = (d: ReturnType<typeof delivery>) =>
    (worker as unknown as { attempt(d: unknown): Promise<void> }).attempt(d);

  return { worker, prisma, dashboardEvents, notifications, attempt };
}

describe('WebhookDeliveryWorker — dashboard realtime nudges (Phase 5D)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('emits webhook.delivery_failed when a delivery attempt fails, scoped to the endpoint\'s project', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 0 }));

    expect(dashboardEvents.publish).toHaveBeenCalledWith('project-1', {
      type: 'webhook.delivery_failed',
      endpointId: 'whe_abc',
      failureCount: 1,
    });
  });

  it('carries the failure streak (consecutiveFailures + 1), not the attempt number', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery({ attempts: 4, consecutiveFailures: 7 }));

    expect(dashboardEvents.publish).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ type: 'webhook.delivery_failed', failureCount: 8 }),
    );
  });

  it('never sends more than endpointId and failureCount on a delivery_failed nudge', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery());

    const [, payload] = dashboardEvents.publish.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['endpointId', 'failureCount', 'type']);
  });

  it('emits webhook.endpoint_disabled in addition to delivery_failed when the failure streak crosses the disable threshold', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    // disableAfterConsecutiveFailures is 3; this failure is the 3rd.
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 }));

    expect(dashboardEvents.publish).toHaveBeenCalledWith('project-1', {
      type: 'webhook.delivery_failed',
      endpointId: 'whe_abc',
      failureCount: 3,
    });
    expect(dashboardEvents.publish).toHaveBeenCalledWith('project-1', {
      type: 'webhook.endpoint_disabled',
      endpointId: 'whe_abc',
    });
    expect(dashboardEvents.publish).toHaveBeenCalledTimes(2);
  });

  it('does not emit webhook.endpoint_disabled while still under the disable threshold', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 0 })); // -> 1, threshold is 3

    expect(dashboardEvents.publish).toHaveBeenCalledTimes(1);
    expect(dashboardEvents.publish).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'webhook.endpoint_disabled' }),
    );
  });

  it('actually persists the DISABLED status alongside publishing the nudge — the two never disagree', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, prisma } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 }));

    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ep-row-1' },
        data: expect.objectContaining({ consecutiveFailures: 3, status: WebhookEndpointStatus.DISABLED }),
      }),
    );
  });

  it('publishes only after the authoritative writes have already committed', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, prisma, dashboardEvents } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 }));

    const lastWriteOrder = prisma.webhookEndpoint.update.mock.invocationCallOrder[0];
    const firstPublishOrder = dashboardEvents.publish.mock.invocationCallOrder[0];
    expect(lastWriteOrder).toBeLessThan(firstPublishOrder);
  });

  it('does not wait on the publish before resolving — fire-and-forget, so a slow Redis never delays the worker', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, dashboardEvents } = makeWorker();
    let releasePublish!: () => void;
    dashboardEvents.publish.mockReturnValue(new Promise<void>((resolve) => (releasePublish = resolve)));

    // attempt() resolves even though the publish() promise it fired (via
    // `void`) is still pending — proving the worker never awaits it.
    await expect(attempt(delivery())).resolves.toBeUndefined();

    releasePublish();
  });

  it('emits no dashboard event for a successful delivery', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 }));

    expect(dashboardEvents.publish).not.toHaveBeenCalled();
  });

  it('emits no dashboard event for an unrelated endpoint\'s successful delivery, even mid-failure-streak elsewhere', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const { attempt, dashboardEvents } = makeWorker();

    await attempt(
      delivery({ consecutiveFailures: 5 }), // would have crossed the disable threshold on a failure
    );

    expect(dashboardEvents.publish).not.toHaveBeenCalled();
  });
});

describe('WebhookDeliveryWorker — persistent notifications (Phase 5F)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('persists a WEBHOOK_DELIVERY_FAILED notification on every failed attempt, deduped per endpoint', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, notifications } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 4 }));

    expect(notifications.notifyProject).toHaveBeenCalledWith(
      { projectId: 'project-1', environment: 'PRODUCTION' },
      expect.objectContaining({
        type: 'WEBHOOK_DELIVERY_FAILED',
        dedupeKey: 'webhook:delivery_failed:whe_abc',
        payload: { endpointId: 'whe_abc' },
      }),
    );
  });

  it('additionally persists a WEBHOOK_ENDPOINT_DISABLED notification once the streak crosses the threshold', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, notifications } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 })); // -> 3, threshold is 3

    expect(notifications.notifyProject).toHaveBeenCalledWith(
      { projectId: 'project-1', environment: 'PRODUCTION' },
      expect.objectContaining({ type: 'WEBHOOK_ENDPOINT_DISABLED', dedupeKey: 'webhook:endpoint_disabled:whe_abc' }),
    );
    expect(notifications.notifyProject).toHaveBeenCalledTimes(2); // delivery_failed + endpoint_disabled
  });

  it('does not persist an endpoint_disabled notification while still under the threshold', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { attempt, notifications } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 0 })); // -> 1, threshold is 3

    expect(notifications.notifyProject).toHaveBeenCalledTimes(1);
    expect(notifications.notifyProject).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'WEBHOOK_ENDPOINT_DISABLED' }),
    );
  });

  it('persists no notification for a successful delivery', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { attempt, notifications } = makeWorker();

    await attempt(delivery({ consecutiveFailures: 2 }));

    expect(notifications.notifyProject).not.toHaveBeenCalled();
  });
});
