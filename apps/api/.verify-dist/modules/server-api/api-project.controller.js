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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiProjectController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_project_id_decorator_1 = require("../api-keys/decorators/current-project-id.decorator");
const api_key_auth_guard_1 = require("../api-keys/guards/api-key-auth.guard");
const projects_service_1 = require("../projects/projects.service");
let ApiProjectController = class ApiProjectController {
    constructor(projectsService) {
        this.projectsService = projectsService;
    }
    get(projectId) {
        return this.projectsService.findOneById(projectId);
    }
};
exports.ApiProjectController = ApiProjectController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Get the API key's own project" }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'The project this API key belongs to' }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ApiProjectController.prototype, "get", null);
exports.ApiProjectController = ApiProjectController = __decorate([
    (0, swagger_1.ApiTags)('Project'),
    (0, swagger_1.ApiBearerAuth)('apiKey'),
    (0, common_1.Controller)('v1/project'),
    (0, common_1.UseGuards)(api_key_auth_guard_1.ApiKeyAuthGuard),
    __metadata("design:paramtypes", [projects_service_1.ProjectsService])
], ApiProjectController);
//# sourceMappingURL=api-project.controller.js.map