"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeysService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("../../generated/prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
const crypto_util_1 = require("../../shared/utils/crypto.util");
const SECRET_SALT_ROUNDS = 10;
let ApiKeysService = class ApiKeysService {
    constructor(prisma, configService) {
        this.prisma = prisma;
        this.configService = configService;
    }
    pepperedSecret(secret) {
        return (0, crypto_util_1.pepper)(secret, this.configService.get('apiKey.pepper'));
    }
    async create(projectId, dto) {
        const publicId = (0, crypto_util_1.generateApiKeyPublicId)();
        const secret = (0, crypto_util_1.generateApiKeySecret)();
        const secretHash = await bcrypt.hash(this.pepperedSecret(secret), SECRET_SALT_ROUNDS);
        const apiKey = await this.prisma.apiKey.create({
            data: { projectId, publicId, secretHash, name: dto.name },
        });
        return {
            id: apiKey.id,
            name: apiKey.name,
            publicId: apiKey.publicId,
            key: `${publicId}.${secret}`,
            createdAt: apiKey.createdAt,
        };
    }
    findAllForProject(projectId) {
        return this.prisma.apiKey.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                projectId: true,
                publicId: true,
                name: true,
                status: true,
                lastUsedAt: true,
                createdAt: true,
                revokedAt: true,
            },
        });
    }
    async revoke(projectId, keyId) {
        const apiKey = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
        if (!apiKey || apiKey.projectId !== projectId) {
            throw new app_error_1.NotFoundError('API key');
        }
        await this.prisma.apiKey.update({
            where: { id: keyId },
            data: { status: client_1.ApiKeyStatus.REVOKED, revokedAt: new Date() },
        });
    }
    async verify(rawKey) {
        const [publicId, secret] = rawKey.split('.', 2);
        if (!publicId || !secret) {
            throw new app_error_1.UnauthorizedError('Malformed API key');
        }
        const apiKey = await this.prisma.apiKey.findUnique({
            where: { publicId },
            include: { project: true },
        });
        if (!apiKey || apiKey.status !== client_1.ApiKeyStatus.ACTIVE) {
            throw new app_error_1.UnauthorizedError('Invalid or revoked API key');
        }
        const matches = await bcrypt.compare(this.pepperedSecret(secret), apiKey.secretHash);
        if (!matches) {
            throw new app_error_1.UnauthorizedError('Invalid API key');
        }
        this.prisma.apiKey
            .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
            .catch(() => undefined);
        return apiKey.project;
    }
};
exports.ApiKeysService = ApiKeysService;
exports.ApiKeysService = ApiKeysService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], ApiKeysService);
//# sourceMappingURL=api-keys.service.js.map