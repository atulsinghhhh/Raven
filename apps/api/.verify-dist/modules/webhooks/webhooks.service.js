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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
const crypto_util_1 = require("../../shared/utils/crypto.util");
let WebhooksService = class WebhooksService {
    constructor(prisma, configService) {
        this.prisma = prisma;
        this.configService = configService;
    }
    get environment() {
        return this.configService.get('env') ?? 'development';
    }
    async create(projectId, dto) {
        assertDeliverableUrl(dto.url, this.environment);
        const signingSecret = `whsec_${(0, crypto_1.randomBytes)(32).toString('base64url')}`;
        const endpoint = await this.prisma.webhookEndpoint.create({
            data: {
                publicId: (0, crypto_util_1.generateId)('whe'),
                projectId,
                url: dto.url,
                description: dto.description,
                enabledEvents: dto.events ?? [],
                signingSecret,
            },
        });
        return {
            ...strip(endpoint),
            signingSecret,
            warning: 'Store this signing secret now — it is never shown again.',
        };
    }
    async list(projectId) {
        const endpoints = await this.prisma.webhookEndpoint.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
        });
        return endpoints.map(strip);
    }
    async update(projectId, publicId, dto) {
        const endpoint = await this.findOne(projectId, publicId);
        if (dto.url) {
            assertDeliverableUrl(dto.url, this.environment);
        }
        const updated = await this.prisma.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: {
                url: dto.url,
                description: dto.description,
                enabledEvents: dto.events,
                status: dto.status,
                ...(dto.status === client_1.WebhookEndpointStatus.ACTIVE ? { consecutiveFailures: 0 } : {}),
            },
        });
        return strip(updated);
    }
    async remove(projectId, publicId) {
        const endpoint = await this.findOne(projectId, publicId);
        await this.prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    }
    async listDeliveries(projectId, publicId, limit = 50) {
        const endpoint = await this.findOne(projectId, publicId);
        return this.prisma.webhookDelivery.findMany({
            where: { endpointId: endpoint.id },
            include: { event: { select: { publicId: true, type: true, createdAt: true } } },
            orderBy: { createdAt: 'desc' },
            take: Math.min(limit, 200),
        });
    }
    async findOne(projectId, publicId) {
        const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { publicId } });
        if (!endpoint || endpoint.projectId !== projectId) {
            throw new app_error_1.NotFoundError('Webhook endpoint');
        }
        return endpoint;
    }
};
exports.WebhooksService = WebhooksService;
exports.WebhooksService = WebhooksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], WebhooksService);
function strip(endpoint) {
    const { signingSecret: _secret, ...rest } = endpoint;
    return rest;
}
function assertDeliverableUrl(rawUrl, environment) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw new app_error_1.ValidationFailedError('url must be a valid absolute URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new app_error_1.ValidationFailedError('url must use http:// or https://');
    }
    if (environment === 'production' && url.protocol !== 'https:') {
        throw new app_error_1.ValidationFailedError('Webhook URLs must use https:// in production');
    }
    const host = url.hostname.toLowerCase();
    const blocked = host === 'localhost' ||
        host === '0.0.0.0' ||
        host.endsWith('.localhost') ||
        host.endsWith('.internal') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host === '::1' ||
        host === '[::1]';
    if (blocked && environment !== 'development' && environment !== 'test') {
        throw new app_error_1.ValidationFailedError('url may not point at a loopback or private-network address');
    }
}
//# sourceMappingURL=webhooks.service.js.map