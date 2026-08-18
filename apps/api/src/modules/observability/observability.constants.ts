/**
 * The fixed vocabulary of events @raven/rtc may ingest (Phase 9 spec
 * §5-7). Deliberately one flat list, not per-entity enums — a single
 * ingest endpoint handles connection, participant, and error events
 * alike, distinguished only by `type`. See docs/telemetry.md#event-types.
 */
export const CONNECTION_EVENT_TYPES = [
  'connection_started',
  'connected',
  'reconnecting',
  'reconnected',
  'disconnected',
  'connection_failed',
  'ice_state_changed',
  'signaling_state_changed',
  'participant_joined',
  'participant_left',
  'participant_reconnected',
  'participant_connection_failed',
  'participant_connection_quality_changed',
  'track_published',
  'track_unpublished',
  'error',
] as const;

export type ConnectionEventType = (typeof CONNECTION_EVENT_TYPES)[number];
