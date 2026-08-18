"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerApiModule = void 0;
const common_1 = require("@nestjs/common");
const api_keys_module_1 = require("../api-keys/api-keys.module");
const observability_module_1 = require("../observability/observability.module");
const projects_module_1 = require("../projects/projects.module");
const api_observability_controller_1 = require("./api-observability.controller");
const api_project_controller_1 = require("./api-project.controller");
let ServerApiModule = class ServerApiModule {
};
exports.ServerApiModule = ServerApiModule;
exports.ServerApiModule = ServerApiModule = __decorate([
    (0, common_1.Module)({
        imports: [api_keys_module_1.ApiKeysModule, projects_module_1.ProjectsModule, observability_module_1.ObservabilityModule],
        controllers: [api_project_controller_1.ApiProjectController, api_observability_controller_1.ApiObservabilityController],
    })
], ServerApiModule);
//# sourceMappingURL=server-api.module.js.map