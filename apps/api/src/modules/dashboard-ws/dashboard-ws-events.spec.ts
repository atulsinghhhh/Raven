import { readFileSync } from 'fs';
import { join } from 'path';
import { DashboardWsEventType } from './dashboard-ws-events';

const SRC_ROOT = join(__dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), 'utf8');
}

describe('DashboardWsEventType', () => {
  it('matches the actual domain terminology already in the repository', () => {
    expect(DashboardWsEventType.ConnectionStateChanged).toBe('connection.state_changed');
    expect(DashboardWsEventType.RoomCreated).toBe('room.created');
    expect(DashboardWsEventType.WebhookDeliveryFailed).toBe('webhook.delivery_failed');
    expect(DashboardWsEventType.WebhookEndpointDisabled).toBe('webhook.endpoint_disabled');
    expect(DashboardWsEventType.LiveStreamStarted).toBe('live_stream.started');
    expect(DashboardWsEventType.LiveStreamEnded).toBe('live_stream.ended');
    expect(DashboardWsEventType.NotificationCreated).toBe('notification.created');
  });

  it('live_stream.started/ended reuse the exact canonical WEBHOOK_EVENT_TYPES strings — not a lookalike name', () => {
    const source = read('modules/webhooks/webhook-events.service.ts');
    expect(source).toMatch(/'live_stream\.started'/);
    expect(source).toMatch(/'live_stream\.ended'/);
  });

  it('there is no viewer-count event — deliberately deferred, not a fake approximation (Phase 5E)', () => {
    const keys = Object.values(DashboardWsEventType) as string[];
    expect(keys.some((k) => k.includes('viewer'))).toBe(false);
  });
});

/**
 * Unlike the room.created/chat-membership case, live_stream.started/ended
 * is NOT a naming collision: LiveStreamsService.start()/end() is the one
 * producer of both the webhook emit and this dashboard nudge, in the same
 * method, for the same real event. This just confirms that stays true —
 * no other module quietly grows a second producer for these two events.
 */
describe('live_stream.started/ended — single producer (Phase 5E)', () => {
  it('LiveStreamsService is the one place that publishes these dashboard events', () => {
    const source = read('modules/live-streams/live-streams.service.ts');
    expect(source).toMatch(/DashboardWsEventType\.LiveStreamStarted/);
    expect(source).toMatch(/DashboardWsEventType\.LiveStreamEnded/);
  });

  it('the egress control service — a different producer of live_stream.* webhooks (broadcast_ready/egress_failed) — does not also publish dashboard events', () => {
    const source = read('modules/live-streams/egress/egress-control.service.ts');
    expect(source).not.toMatch(/DashboardWsEventType|DashboardEventsService/);
  });
});

/**
 * The Phase 5A audit's specific finding: WEBHOOK_EVENT_TYPES declares
 * `room.created`/`participant.joined`/`participant.left`, but those fire
 * from chat conversation membership (ConversationsService), not from real
 * RTC room/participant lifecycle. Phase 5C's dashboard `room.created` must
 * never be confused with, or produced by, that same machinery — these are
 * static source checks, not runtime behavior, because the invariant that
 * matters is architectural: which file is allowed to import
 * DashboardEventsService and publish this event type at all.
 */
describe('no chat-membership / RTC-room event collision (Phase 5A finding, Phase 5C guard)', () => {
  it("ConversationsService — the actual producer of the webhook module's room.created/participant.* — never imports the dashboard realtime publisher", () => {
    const source = read('modules/chat/conversations/conversations.service.ts');
    expect(source).not.toMatch(/DashboardEventsService/);
    expect(source).not.toMatch(/dashboard-ws/);
  });

  it('no chat module file publishes a dashboard-ws event', () => {
    const source = read('modules/chat/chat.module.ts');
    expect(source).not.toMatch(/DashboardEventsService/);
    expect(source).not.toMatch(/DashboardWsModule/);
  });

  it("RoomsService — the sole producer of the dashboard's room.created — is the real RTC room lifecycle, not chat", () => {
    const source = read('modules/rooms/rooms.service.ts');
    expect(source).toMatch(/DashboardWsEventType\.RoomCreated/);
    // The published roomId comes from `room.id` (the just-created Room
    // row this same method returns), never from a conversation/chat
    // identifier.
    expect(source).toMatch(/roomId:\s*room\.id/);
    expect(source).not.toMatch(/ConversationsService|conversationId/);
  });

  it("the webhook module's room.created stays entirely separate: DashboardWsEventType is never imported by webhooks", () => {
    const source = read('modules/webhooks/webhook-events.service.ts');
    expect(source).not.toMatch(/DashboardWsEventType|DashboardEventsService/);
  });
});

/**
 * notification.created (Phase 5F) is published from exactly one place:
 * NotificationsService.notifyProject(), after the Notification rows it
 * upserts have committed. Producers (WebhookDeliveryWorker,
 * LiveStreamsService) call notifyProject() — they never publish this
 * event type themselves, which is what keeps "a notification was
 * persisted" and "the dashboard was told to refetch" from being able to
 * drift apart.
 */
describe('notification.created — single producer (Phase 5F)', () => {
  it('NotificationsService is the one place that publishes notification.created', () => {
    const source = read('modules/notifications/notifications.service.ts');
    expect(source).toMatch(/DashboardWsEventType\.NotificationCreated/);
  });

  it('producers call notifyProject() rather than publishing notification.created themselves', () => {
    const worker = read('modules/webhooks/webhook-delivery.worker.ts');
    const liveStreams = read('modules/live-streams/live-streams.service.ts');
    expect(worker).not.toMatch(/DashboardWsEventType\.NotificationCreated/);
    expect(liveStreams).not.toMatch(/DashboardWsEventType\.NotificationCreated/);
    expect(worker).toMatch(/notifications\.notifyProject/);
    expect(liveStreams).toMatch(/notifications\.notifyProject/);
  });
});
