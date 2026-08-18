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
exports.DashboardRoomsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../projects/projects.service");
const create_room_dto_1 = require("./dto/create-room.dto");
const rooms_service_1 = require("./rooms.service");
let DashboardRoomsController = class DashboardRoomsController {
    constructor(roomsService, projectsService) {
        this.roomsService = roomsService;
        this.projectsService = projectsService;
    }
    async create(user, projectId, dto) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.roomsService.create(projectId, dto);
    }
    async findAll(user, projectId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.roomsService.findAllForProjectWithLiveState(projectId);
    }
    async findOne(user, projectId, roomId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.roomsService.findOneForProjectWithLiveState(roomId, projectId);
    }
};
exports.DashboardRoomsController = DashboardRoomsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a room in this project' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Room created' }),
    (0, swagger_1.ApiConflictResponse)({ description: 'A room with this name already exists in this project' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_room_dto_1.CreateRoomDto]),
    __metadata("design:returntype", Promise)
], DashboardRoomsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "List a project's rooms with live participant counts" }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rooms, each with liveParticipantCount (null if LiveKit is unreachable)' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DashboardRoomsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':roomId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one room with its live participants and published tracks' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Room with liveParticipants (null if LiveKit is unreachable)' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or room not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('roomId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DashboardRoomsController.prototype, "findOne", null);
exports.DashboardRoomsController = DashboardRoomsController = __decorate([
    (0, swagger_1.ApiTags)('Dashboard — Rooms'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId/rooms'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [rooms_service_1.RoomsService,
        projects_service_1.ProjectsService])
], DashboardRoomsController);
//# sourceMappingURL=dashboard-rooms.controller.js.map