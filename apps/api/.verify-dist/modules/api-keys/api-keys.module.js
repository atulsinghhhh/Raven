"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeysModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const projects_module_1 = require("../projects/projects.module");
const api_keys_controller_1 = require("./api-keys.controller");
const api_keys_service_1 = require("./api-keys.service");
const api_key_auth_guard_1 = require("./guards/api-key-auth.guard");
let ApiKeysModule = class ApiKeysModule {
};
exports.ApiKeysModule = ApiKeysModule;
exports.ApiKeysModule = ApiKeysModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, projects_module_1.ProjectsModule],
        controllers: [api_keys_controller_1.ApiKeysController],
        providers: [api_keys_service_1.ApiKeysService, api_key_auth_guard_1.ApiKeyAuthGuard],
        exports: [api_keys_service_1.ApiKeysService, api_key_auth_guard_1.ApiKeyAuthGuard],
    })
], ApiKeysModule);
//# sourceMappingURL=api-keys.module.js.map