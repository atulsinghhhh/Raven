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
exports.ErrorsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
let ErrorsService = class ErrorsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listForProject(projectId, query) {
        const rows = await this.prisma.errorEvent.findMany({
            where: {
                projectId,
                ...(query.category ? { category: query.category } : {}),
                ...(query.connectionId ? { connection: { publicId: query.connectionId } } : {}),
            },
            orderBy: { timestamp: 'desc' },
            take: query.limit,
            include: { connection: true },
        });
        return rows.map((row) => this.serialize(row));
    }
    async getDetail(projectId, publicId) {
        const errorEvent = await this.prisma.errorEvent.findUnique({
            where: { publicId },
            include: { connection: true },
        });
        if (!errorEvent || errorEvent.projectId !== projectId) {
            throw new app_error_1.NotFoundError('Error');
        }
        return { ...this.serialize(errorEvent), connection: errorEvent.connection };
    }
    serialize(row) {
        const { connection, ...rest } = row;
        return { ...rest, connectionId: connection?.publicId ?? null };
    }
};
exports.ErrorsService = ErrorsService;
exports.ErrorsService = ErrorsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ErrorsService);
//# sourceMappingURL=errors.service.js.map