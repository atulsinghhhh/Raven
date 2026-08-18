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
exports.ApiKeyAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const app_error_1 = require("../../../shared/errors/app-error");
const api_keys_service_1 = require("../api-keys.service");
let ApiKeyAuthGuard = class ApiKeyAuthGuard {
    constructor(apiKeysService) {
        this.apiKeysService = apiKeysService;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const header = request.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            throw new app_error_1.UnauthorizedError('Missing API key');
        }
        const project = await this.apiKeysService.verify(header.slice('Bearer '.length));
        request.apiProjectId = project.id;
        return true;
    }
};
exports.ApiKeyAuthGuard = ApiKeyAuthGuard;
exports.ApiKeyAuthGuard = ApiKeyAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [api_keys_service_1.ApiKeysService])
], ApiKeyAuthGuard);
//# sourceMappingURL=api-key-auth.guard.js.map