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
var RetentionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../shared/database/prisma.service");
const DAY_MS = 24 * 60 * 60 * 1000;
let RetentionService = RetentionService_1 = class RetentionService {
    constructor(prisma, configService) {
        this.prisma = prisma;
        this.configService = configService;
        this.logger = new common_1.Logger(RetentionService_1.name);
    }
    onModuleInit() {
        const intervalMs = this.configService.get('observability.retentionSweepIntervalMs');
        this.timer = setInterval(() => void this.runSweep(), intervalMs);
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async sweep() {
        const connectionCutoff = new Date(Date.now() - this.configService.get('observability.connectionRetentionDays') * DAY_MS);
        const errorCutoff = new Date(Date.now() - this.configService.get('observability.errorRetentionDays') * DAY_MS);
        const [connections, errors] = await Promise.all([
            this.prisma.connection.deleteMany({ where: { createdAt: { lt: connectionCutoff } } }),
            this.prisma.errorEvent.deleteMany({ where: { timestamp: { lt: errorCutoff } } }),
        ]);
        return { connectionsDeleted: connections.count, errorsDeleted: errors.count };
    }
    async runSweep() {
        try {
            const result = await this.sweep();
            if (result.connectionsDeleted > 0 || result.errorsDeleted > 0) {
                this.logger.log(`retention sweep: removed ${result.connectionsDeleted} connections, ${result.errorsDeleted} errors`);
            }
        }
        catch (error) {
            this.logger.error(`retention sweep failed: ${error.message}`);
        }
    }
};
exports.RetentionService = RetentionService;
exports.RetentionService = RetentionService = RetentionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], RetentionService);
//# sourceMappingURL=retention.service.js.map