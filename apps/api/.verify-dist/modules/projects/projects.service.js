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
exports.ProjectsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
let ProjectsService = class ProjectsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(ownerId, dto) {
        return this.prisma.project.create({
            data: { name: dto.name, description: dto.description, ownerId },
        });
    }
    findAllForOwner(ownerId) {
        return this.prisma.project.findMany({
            where: { ownerId, status: client_1.ProjectStatus.ACTIVE },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOneById(id) {
        const project = await this.prisma.project.findUnique({ where: { id } });
        if (!project) {
            throw new app_error_1.NotFoundError('Project');
        }
        return project;
    }
    async findOneForOwner(id, ownerId) {
        const project = await this.prisma.project.findUnique({ where: { id } });
        if (!project || project.ownerId !== ownerId) {
            throw new app_error_1.NotFoundError('Project');
        }
        return project;
    }
    async update(id, ownerId, dto) {
        await this.findOneForOwner(id, ownerId);
        return this.prisma.project.update({ where: { id }, data: dto });
    }
    async archive(id, ownerId) {
        await this.findOneForOwner(id, ownerId);
        await this.prisma.project.update({
            where: { id },
            data: { status: client_1.ProjectStatus.ARCHIVED },
        });
    }
};
exports.ProjectsService = ProjectsService;
exports.ProjectsService = ProjectsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProjectsService);
//# sourceMappingURL=projects.service.js.map