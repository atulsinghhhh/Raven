import { ActivityActorType, ActivityEventType } from '../../generated/prisma/enums';

export { ActivityActorType, ActivityEventType };

/** Every value grouped by product, purely for building filter UIs — the enum itself is the source of truth. */
export const ACTIVITY_EVENT_GROUPS: Record<string, ActivityEventType[]> = {
  Authentication: [
    ActivityEventType.USER_SIGNED_UP,
    ActivityEventType.USER_LOGIN,
    ActivityEventType.USER_LOGOUT,
    ActivityEventType.LOGIN_FAILED,
    ActivityEventType.PASSWORD_CHANGED,
    ActivityEventType.OAUTH_CONNECTED,
  ],
  Projects: [
    ActivityEventType.PROJECT_CREATED,
    ActivityEventType.PROJECT_UPDATED,
    ActivityEventType.PROJECT_DELETED,
    ActivityEventType.PROJECT_MEMBER_ADDED,
    ActivityEventType.PROJECT_MEMBER_REMOVED,
  ],
  API: [ActivityEventType.API_KEY_CREATED, ActivityEventType.API_KEY_REVOKED, ActivityEventType.API_REQUEST_FAILED],
  RTC: [
    ActivityEventType.RTC_ROOM_CREATED,
    ActivityEventType.RTC_ROOM_ENDED,
    ActivityEventType.RTC_PARTICIPANT_JOINED,
    ActivityEventType.RTC_PARTICIPANT_LEFT,
    ActivityEventType.RTC_CONNECTION_FAILED,
    ActivityEventType.RTC_RECONNECT,
    ActivityEventType.RTC_TOKEN_CREATED,
  ],
  Chat: [
    ActivityEventType.CHAT_CONVERSATION_CREATED,
    ActivityEventType.CHAT_MEMBER_ADDED,
    ActivityEventType.CHAT_MESSAGE_SENT,
    ActivityEventType.CHAT_MESSAGE_FAILED,
  ],
  'Live Streaming': [
    ActivityEventType.LIVE_STREAM_CREATED,
    ActivityEventType.LIVE_STREAM_STARTED,
    ActivityEventType.LIVE_STREAM_ENDED,
    ActivityEventType.LIVE_STREAM_HOST_JOINED,
    ActivityEventType.LIVE_STREAM_VIEWER_JOINED,
    ActivityEventType.LIVE_STREAM_FAILED,
  ],
  Integration: [
    ActivityEventType.INTEGRATION_STACK_SELECTED,
    ActivityEventType.INTEGRATION_CONNECTION_TESTED,
    ActivityEventType.INTEGRATION_CONNECTION_SUCCEEDED,
    ActivityEventType.INTEGRATION_CONNECTION_FAILED,
  ],
  Security: [
    ActivityEventType.SUSPICIOUS_ACTIVITY,
    ActivityEventType.RATE_LIMIT_TRIGGERED,
    ActivityEventType.ACCOUNT_SUSPENDED,
    ActivityEventType.ACCOUNT_UNSUSPENDED,
  ],
  Admin: [
    ActivityEventType.ADMIN_LOGIN,
    ActivityEventType.ADMIN_USER_VIEWED,
    ActivityEventType.ADMIN_PROJECT_VIEWED,
    ActivityEventType.ADMIN_ACCOUNT_SUSPENDED,
    ActivityEventType.ADMIN_ACCOUNT_UNSUSPENDED,
    ActivityEventType.ADMIN_LIMIT_CHANGED,
    ActivityEventType.ADMIN_ACTION,
  ],
};
