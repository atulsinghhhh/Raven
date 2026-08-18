"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityModule = void 0;
const common_1 = require("@nestjs/common");
const projects_module_1 = require("../projects/projects.module");
const signaling_module_1 = require("../signaling/signaling.module");
const connections_service_1 = require("./connections.service");
const dashboard_observability_controller_1 = require("./dashboard-observability.controller");
const diagnostics_service_1 = require("./diagnostics.service");
const errors_service_1 = require("./errors.service");
const telemetry_ingest_guard_1 = require("./guards/telemetry-ingest.guard");
const metrics_service_1 = require("./metrics.service");
const retention_service_1 = require("./retention.service");
const telemetry_controller_1 = require("./telemetry.controller");
let ObservabilityModule = class ObservabilityModule {
};
exports.ObservabilityModule = ObservabilityModule;
exports.ObservabilityModule = ObservabilityModule = __decorate([
    (0, common_1.Module)({
        imports: [projects_module_1.ProjectsModule, signaling_module_1.SignalingModule],
        controllers: [telemetry_controller_1.TelemetryController, dashboard_observability_controller_1.DashboardObservabilityController],
        providers: [
            connections_service_1.ConnectionsService,
            errors_service_1.ErrorsService,
            metrics_service_1.MetricsService,
            diagnostics_service_1.DiagnosticsService,
            retention_service_1.RetentionService,
            telemetry_ingest_guard_1.TelemetryIngestGuard,
        ],
        exports: [connections_service_1.ConnectionsService, errors_service_1.ErrorsService, metrics_service_1.MetricsService, diagnostics_service_1.DiagnosticsService],
    })
], ObservabilityModule);
//# sourceMappingURL=observability.module.js.map