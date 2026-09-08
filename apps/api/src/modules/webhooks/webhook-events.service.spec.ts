import { WebhookEndpointStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { Environment } from '../../shared/environment/environment.constants';
import { WebhookEventsService } from './webhook-events.service';

describe('WebhookEventsService', () => {
  let service: WebhookEventsService;
  let prisma: {
    webhookEndpoint: { findMany: jest.Mock };
    webhookEvent: { create: jest.Mock };
  };

  const PROD = { projectId: 'p1', environment: Environment.PRODUCTION };
  const DEV = { projectId: 'p1', environment: Environment.DEVELOPMENT };

  beforeEach(() => {
    prisma = {
      webhookEndpoint: { findMany: jest.fn().mockResolvedValue([]) },
      webhookEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new WebhookEventsService(prisma as unknown as PrismaService);
  });

  describe('environment scoping', () => {
    it('only looks at endpoints in the emitting environment', async () => {
      await service.emit(PROD, 'message.created', { message: {} });

      // The consequence of getting this wrong is not a missed delivery;
      // it is real customer messages posted to whatever URL someone
      // pointed at their laptop while testing.
      expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith({
        where: {
          projectId: 'p1',
          environment: Environment.PRODUCTION,
          status: WebhookEndpointStatus.ACTIVE,
        },
        select: { id: true, enabledEvents: true },
      });
    });

    it('records the environment on the event itself', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: 'e1', enabledEvents: [] }]);

      await service.emit(DEV, 'message.created', { message: {} });

      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ environment: Environment.DEVELOPMENT }),
        }),
      );
    });
  });

  describe('subscription filtering', () => {
    it('treats an empty enabledEvents list as "everything"', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: 'e1', enabledEvents: [] }]);

      await service.emit(DEV, 'reaction.added', {});

      expect(prisma.webhookEvent.create).toHaveBeenCalled();
    });

    it('skips an endpoint that did not subscribe to this type', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([
        { id: 'e1', enabledEvents: ['message.deleted'] },
      ]);

      await service.emit(DEV, 'message.created', {});

      // Writing an event row nobody will read leaves the deliveries table
      // growing for no reason.
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('queues one delivery per subscribed endpoint', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([
        { id: 'e1', enabledEvents: [] },
        { id: 'e2', enabledEvents: ['message.created'] },
        { id: 'e3', enabledEvents: ['participant.left'] },
      ]);

      await service.emit(DEV, 'message.created', {});

      const { data } = prisma.webhookEvent.create.mock.calls[0][0];
      expect(data.deliveries.create).toEqual([{ endpointId: 'e1' }, { endpointId: 'e2' }]);
    });
  });

  describe('failure containment', () => {
    it('never throws, so a webhook problem cannot fail the message that caused it', async () => {
      // emit() is called with `void` from the chat services precisely so a
      // developer's broken endpoint cannot roll back a stored message.
      prisma.webhookEndpoint.findMany.mockRejectedValue(new Error('database down'));

      await expect(service.emit(DEV, 'message.created', {})).resolves.toBeUndefined();
    });
  });
});
