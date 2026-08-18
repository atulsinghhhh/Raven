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
exports.DiagnosticsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const dependency_checks_util_1 = require("../health/dependency-checks.util");
const connections_service_1 = require("./connections.service");
let DiagnosticsService = class DiagnosticsService {
    constructor(configService, connectionsService) {
        this.configService = configService;
        this.connectionsService = connectionsService;
    }
    async getDiagnostics(project) {
        const [sfu, turn, active] = await Promise.all([
            (0, dependency_checks_util_1.checkLiveKitHttp)(this.configService.get('livekit.internalUrl')).catch(() => false),
            (0, dependency_checks_util_1.checkStunBinding)(this.configService.get('turn.internalHost'), this.configService.get('turn.port')).catch(() => false),
            this.connectionsService.findActive(project.id),
        ]);
        return {
            project: { id: project.id, name: project.name },
            api: 'up',
            authentication: 'ok',
            dependencies: {
                signaling: 'up',
                sfu: sfu ? 'up' : 'down',
                turn: turn ? 'up' : 'down',
            },
            connections: { active: active.length },
        };
    }
};
exports.DiagnosticsService = DiagnosticsService;
exports.DiagnosticsService = DiagnosticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        connections_service_1.ConnectionsService])
], DiagnosticsService);
//# sourceMappingURL=diagnostics.service.js.map