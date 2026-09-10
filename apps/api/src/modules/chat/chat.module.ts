import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AttachmentsService } from './attachments/attachments.service';
import { ChatAuthGuard } from './auth/chat-auth.guard';
import { ConversationsService } from './conversations/conversations.service';
import { ChatController } from './controllers/chat.controller';
import { DashboardChatController } from './controllers/dashboard-chat.controller';
import { ChatGateway } from './gateway/chat.gateway';
import { ConnectionRegistryService } from './gateway/connection-registry.service';
import { MessagesService } from './messages/messages.service';
import { ChatMetricsService } from './metrics/chat-metrics.service';
import { PresenceService } from './presence/presence.service';
import { ChatRateLimitService } from './rate-limit/chat-rate-limit.service';
import { ReactionsService } from './reactions/reactions.service';
import { ReadStateService } from './read-state/read-state.service';
import { ChatEventsService } from './realtime/chat-events.service';
import { ChatRetentionService } from './retention/chat-retention.service';
import { ChatTokenService } from './tokens/chat-token.service';
import { TypingService } from './typing/typing.service';

/**
 * Livqeno Chat: messaging, entirely separate from the RTC plane.
 *
 * Nothing in here imports SignalingModule or anything under it. The only link
 * between the two planes is `Conversation.roomId`, which lets a video
 * call have a chat panel; either can be used without the other, and
 * either can fail without taking the other down (spec §64).
 */
@Module({
  imports: [ApiKeysModule, ProjectsModule, WebhooksModule],
  controllers: [ChatController, DashboardChatController],
  providers: [
    ChatTokenService,
    ChatAuthGuard,
    ConversationsService,
    MessagesService,
    ReactionsService,
    ReadStateService,
    PresenceService,
    TypingService,
    AttachmentsService,
    ChatEventsService,
    ChatRateLimitService,
    ChatMetricsService,
    ConnectionRegistryService,
    ChatRetentionService,
    ChatGateway,
  ],
  // ChatTokenService is also how Live Streaming mints viewer/host chat
  // tokens for a stream's conversation: the same credential a plain chat
  // integration gets, not a second implementation.
  exports: [ChatGateway, ChatMetricsService, ConversationsService, MessagesService, ChatTokenService],
})
export class ChatModule {}
