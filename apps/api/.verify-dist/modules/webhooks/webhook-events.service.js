"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WebhookEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookEventsService = exports.WEBHOOK_EVENT_TYPES = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const crypto_util_1 = require("../../shared/utils/crypto.util");
exports.WEBHOOK_EVENT_TYPES = [
    'message.created',
    'message.updated',
    'message.deleted',
    'reaction.added',
    'reaction.removed',
    'room.created',
    'participant.joined',
    'participant.left',
];
let WebhookEventsService = WebhookEventsService_1 = class WebhookEventsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(WebhookEventsService_1.name);
    }
    async emit(projectId, type, payload) {
        try {
            const endpoints = await this.prisma.webhookEndpoint.findMany({
                where: { projectId, status: client_1.WebhookEndpointStatus.ACTIVE },
                select: { id: true, enabledEvents: true },
            });
            const subscribed = endpoints.filter((endpoint) => endpoint.enabledEvents.length === 0 || endpoint.enabledEvents.includes(type));
            if (subscribed.length === 0) {
                return;
            }
            await this.prisma.webhookEvent.create({
                data: {
                    publicId: (0, crypto_util_1.generateId)('evt'),
                    projectId,
                    type,
                    payload: payload,
                    deliveries: {
                        create: subscribed.map((endpoint) => ({ endpointId: endpoint.id })),
                    },
                },
            });
        }
        catch (err) {
            this.logger.error(`failed to queue webhook event ${type}: ${err.message}`);
        }
    }
};
exports.WebhookEventsService = WebhookEventsService;
exports.WebhookEventsService = WebhookEventsService = WebhookEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WebhookEventsService);
//# sourceMappingURL=webhook-events.service.js.map