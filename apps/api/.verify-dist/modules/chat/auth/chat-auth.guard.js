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
exports.ChatAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const app_error_1 = require("../../../shared/errors/app-error");
const api_keys_service_1 = require("../../api-keys/api-keys.service");
const chat_permissions_1 = require("../chat-permissions");
const chat_token_service_1 = require("../tokens/chat-token.service");
let ChatAuthGuard = class ChatAuthGuard {
    constructor(apiKeysService, chatTokenService) {
        this.apiKeysService = apiKeysService;
        this.chatTokenService = chatTokenService;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const header = request.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            throw new app_error_1.UnauthorizedError('Missing credentials — send a project API key or a chat token');
        }
        const credential = header.slice('Bearer '.length).trim();
        if (credential.startsWith('rvk_')) {
            const project = await this.apiKeysService.verify(credential);
            request.chatActor = {
                kind: 'server',
                projectId: project.id,
                userId: null,
                scopes: [...chat_permissions_1.CHAT_SCOPES],
            };
            return true;
        }
        const claims = await this.chatTokenService.verify(credential);
        request.chatActor = {
            kind: 'client',
            projectId: claims.pid,
            userId: claims.sub,
            scopes: claims.scopes,
            tokenId: claims.jti,
            conversationScope: claims.cvs,
        };
        return true;
    }
};
exports.ChatAuthGuard = ChatAuthGuard;
exports.ChatAuthGuard = ChatAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [api_keys_service_1.ApiKeysService,
        chat_token_service_1.ChatTokenService])
], ChatAuthGuard);
//# sourceMappingURL=chat-auth.guard.js.map