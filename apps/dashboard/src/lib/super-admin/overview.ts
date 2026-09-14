import { superAdminFetch } from '../super-admin-client';

/**
 * Mirrors `OverviewResponse` in
 * `apps/api/src/modules/super-admin/overview/overview.service.ts` field
 * for field. Keep the two in sync by hand — there's no shared types
 * package between the API and the dashboard.
 */
export interface OverviewResponse {
  generatedAt: string;
  developers: {
    total: number;
    newToday: number;
    newThisWeek: number;
    active: number;
    inactive: number;
    suspended: number;
  };
  projects: {
    total: number;
    active: number;
    newToday: number;
    newThisWeek: number;
  };
  rtc: {
    activeRooms: number;
    activeParticipants: number;
    roomsCreatedToday: number;
    minutesToday: number;
    minutesThisMonth: number;
    peakConcurrentParticipantsToday: number | null;
    failedConnectionsToday: number;
    reconnectRateToday: number | null;
  };
  chat: {
    messagesToday: number;
    messagesThisMonth: number;
    activeConversations: number;
    activeChatUsers: number;
    failedMessagesToday: number;
  };
  liveStreaming: {
    activeStreams: number;
    streamsToday: number;
    totalViewersToday: number;
    peakViewersToday: number;
    avgStreamDurationMsToday: number | null;
    failedStreams: number;
  };
  infrastructure: {
    api: 'up' | 'down';
    database: 'up' | 'down';
    redis: 'up' | 'down';
    sfu: 'up' | 'down';
    turn: 'up' | 'down';
  };
}

/** GET /v1/super-admin/overview — any platform role may read it. */
export function getOverview(token: string): Promise<OverviewResponse> {
  return superAdminFetch<OverviewResponse>('/v1/super-admin/overview', { token });
}
