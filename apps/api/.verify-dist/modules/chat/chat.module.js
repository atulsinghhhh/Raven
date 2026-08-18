"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatModule = void 0;
const common_1 = require("@nestjs/common");
const api_keys_module_1 = require("../api-keys/api-keys.module");
const projects_module_1 = require("../projects/projects.module");
const webhooks_module_1 = require("../webhooks/webhooks.module");
const attachments_service_1 = require("./attachments/attachments.service");
const chat_auth_guard_1 = require("./auth/chat-auth.guard");
const conversations_service_1 = require("./conversations/conversations.service");
const chat_controller_1 = require("./controllers/chat.controller");
const dashboard_chat_controller_1 = require("./controllers/dashboard-chat.controller");
const chat_gateway_1 = require("./gateway/chat.gateway");
const connection_registry_service_1 = require("./gateway/connection-registry.service");
const messages_service_1 = require("./messages/messages.service");
const chat_metrics_service_1 = require("./metrics/chat-metrics.service");
const presence_service_1 = require("./presence/presence.service");
const chat_rate_limit_service_1 = require("./rate-limit/chat-rate-limit.service");
const reactions_service_1 = require("./reactions/reactions.service");
const read_state_service_1 = require("./read-state/read-state.service");
const chat_events_service_1 = require("./realtime/chat-events.service");
const chat_retention_service_1 = require("./retention/chat-retention.service");
const chat_token_service_1 = require("./tokens/chat-token.service");
const typing_service_1 = require("./typing/typing.service");
let ChatModule = class ChatModule {
};
exports.ChatModule = ChatModule;
exports.ChatModule = ChatModule = __decorate([
    (0, common_1.Module)({
        imports: [api_keys_module_1.ApiKeysModule, projects_module_1.ProjectsModule, webhooks_module_1.WebhooksModule],
        controllers: [chat_controller_1.ChatController, dashboard_chat_controller_1.DashboardChatController],
        providers: [
            chat_token_service_1.ChatTokenService,
            chat_auth_guard_1.ChatAuthGuard,
            conversations_service_1.ConversationsService,
            messages_service_1.MessagesService,
            reactions_service_1.ReactionsService,
            read_state_service_1.ReadStateService,
            presence_service_1.PresenceService,
            typing_service_1.TypingService,
            attachments_service_1.AttachmentsService,
            chat_events_service_1.ChatEventsService,
            chat_rate_limit_service_1.ChatRateLimitService,
            chat_metrics_service_1.ChatMetricsService,
            connection_registry_service_1.ConnectionRegistryService,
            chat_retention_service_1.ChatRetentionService,
            chat_gateway_1.ChatGateway,
        ],
        exports: [chat_gateway_1.ChatGateway, chat_metrics_service_1.ChatMetricsService, conversations_service_1.ConversationsService, messages_service_1.MessagesService],
    })
], ChatModule);
//# sourceMappingURL=chat.module.js.map