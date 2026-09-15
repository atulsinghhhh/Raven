/**
 * The dashboard realtime event vocabulary (Phase 5C). Phase 5B left
 * DashboardEventsService's event payload untyped on purpose — "typing this
 * ahead of a real event would just be a guess." These are the first real
 * events, sourced from the actual domain terminology already in the
 * repository (ConnectionState transitions in observability/connections.service.ts,
 * Room creation in rooms/rooms.service.ts).
 *
 * IMPORTANT — do not confuse these with two other, unrelated things that
 * happen to share a name:
 *
 * 1. `WEBHOOK_EVENT_TYPES` (webhooks/webhook-events.service.ts) also
 *    declares `room.created`/`participant.joined`/`participant.left`, but
 *    those are emitted from chat conversation membership
 *    (ConversationsService), not from real RTC room/participant
 *    lifecycle — a naming collision the Phase 5A audit specifically
 *    flagged. This module's `room.created` is sourced from
 *    RoomsService.create() (an actual RTC room), a different producer
 *    entirely, published on a different transport (this project-scoped
 *    Redis channel, not the outbound webhook queue) to a different
 *    consumer (the dashboard's own WebSocket, not a developer's HTTP
 *    endpoint). Nothing here reuses or is reused by the webhook vocabulary.
 * 2. There is no dashboard event for chat conversation membership at all —
 *    Phase 5C was Connections and Rooms only.
 *
 * Phase 5D adds `webhook.delivery_failed`/`webhook.endpoint_disabled`,
 * sourced from WebhookDeliveryWorker.attempt() — the one place the
 * backend already computes a delivery failure and an endpoint's
 * consecutive-failure streak. These are unrelated to WEBHOOK_EVENT_TYPES
 * too: that array names events delivered *to* a developer's own endpoint
 * (message.created, room.created, live_stream.*); these two describe the
 * delivery pipeline's own health, to the dashboard, over this entirely
 * separate transport.
 *
 * Phase 5E adds `live_stream.started`/`live_stream.ended`, published from
 * the exact same call sites in LiveStreamsService.start()/end() that
 * already emit the same-named WEBHOOK_EVENT_TYPES entries — unlike the
 * `room.created` case above, this is NOT a naming collision: both the
 * webhook and this dashboard nudge describe the identical real event,
 * from the identical producer, just fanned out to two different
 * consumers over two different transports. There is deliberately no
 * `live_stream.viewer_count_changed` — see the doc comment on
 * LiveStreamsService.toView(): viewer count is polled from the SFU on
 * demand and never stored, and the only existing lifecycle hooks close
 * enough to a "count changed" moment
 * (`live_stream.viewer_joined`/`viewer_left`) are unreliable for this
 * purpose — `viewer_joined` fires on credential mint, not actual
 * connection, and `viewer_left` only fires on a clean SDK-initiated
 * leave, never a dropped connection (LiveStreamsService's own comment
 * above `leave()`). Wiring a dashboard nudge to either would be exactly
 * the "fake frontend approximation" this phase's brief said not to
 * build. Deferred, not implemented as a stub.
 *
 * Phase 5F adds `notification.created`, published by
 * NotificationsService.notifyProject() *after* the persistent Notification
 * rows it fans out to each project member have already committed — the
 * database, not this event, is authoritative. This is deliberately the
 * only event in this file with no resource-specific fields: unlike
 * connection/room/webhook/live-stream nudges (which name the one resource
 * that changed), a client can't know in advance which of a project's
 * members it's rendering for, so there's nothing safe to put in the
 * payload beyond "go refetch your own notifications" —
 * GET /v1/projects/:id/notifications is what answers "which ones, and
 * for whom".
 */
export const DashboardWsEventType = {
  ConnectionStateChanged: 'connection.state_changed',
  RoomCreated: 'room.created',
  WebhookDeliveryFailed: 'webhook.delivery_failed',
  WebhookEndpointDisabled: 'webhook.endpoint_disabled',
  LiveStreamStarted: 'live_stream.started',
  LiveStreamEnded: 'live_stream.ended',
  NotificationCreated: 'notification.created',
} as const;

export type DashboardWsEventType = (typeof DashboardWsEventType)[keyof typeof DashboardWsEventType];

/**
 * A nudge, not a snapshot: enough to tell a subscribed dashboard tab which
 * connection changed and to what, never the full `Connection` row. REST
 * (`GET /v1/projects/:id/connections`) stays the authoritative source the
 * client refetches from — see docs on DashboardWsGateway.
 */
export interface ConnectionStateChangedEvent {
  type: typeof DashboardWsEventType.ConnectionStateChanged;
  connectionId: string;
  roomId: string | null;
  state: string;
}

/** Same nudge shape for room creation — enough to know to refetch the room list, never the full `Room` row. */
export interface RoomCreatedEvent {
  type: typeof DashboardWsEventType.RoomCreated;
  roomId: string;
  name: string;
  environment: string;
}

/** A delivery attempt failed. `failureCount` is the endpoint's consecutive-failure streak (the same figure the dashboard already renders inline), not the attempt number within one delivery. */
export interface WebhookDeliveryFailedEvent {
  type: typeof DashboardWsEventType.WebhookDeliveryFailed;
  endpointId: string;
  failureCount: number;
}

/** The endpoint just crossed the auto-disable threshold. No failureCount here — by the time this fires, `status` itself is the thing that changed; the dashboard refetches the endpoint to see the final count. */
export interface WebhookEndpointDisabledEvent {
  type: typeof DashboardWsEventType.WebhookEndpointDisabled;
  endpointId: string;
}

/** A stream transitioned CREATED → LIVE. `streamId` is the public id (`stream_...`) — enough to refetch the list or this one stream's detail, never the full LiveStreamView. */
export interface LiveStreamStartedEvent {
  type: typeof DashboardWsEventType.LiveStreamStarted;
  streamId: string;
}

/** A stream transitioned LIVE → ENDED. Same minimal shape as LiveStreamStartedEvent. */
export interface LiveStreamEndedEvent {
  type: typeof DashboardWsEventType.LiveStreamEnded;
  streamId: string;
}

/** "Something changed in your notifications for this project — go refetch." No resource id: see the class comment above for why. */
export interface NotificationCreatedEvent {
  type: typeof DashboardWsEventType.NotificationCreated;
}

export type DashboardWsEvent =
  | ConnectionStateChangedEvent
  | RoomCreatedEvent
  | WebhookDeliveryFailedEvent
  | WebhookEndpointDisabledEvent
  | LiveStreamStartedEvent
  | LiveStreamEndedEvent
  | NotificationCreatedEvent;
