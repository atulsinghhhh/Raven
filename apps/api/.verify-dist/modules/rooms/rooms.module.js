"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsModule = void 0;
const common_1 = require("@nestjs/common");
const api_keys_module_1 = require("../api-keys/api-keys.module");
const projects_module_1 = require("../projects/projects.module");
const dashboard_rooms_controller_1 = require("./dashboard-rooms.controller");
const livekit_room_service_1 = require("./livekit-room.service");
const rooms_controller_1 = require("./rooms.controller");
const rooms_service_1 = require("./rooms.service");
let RoomsModule = class RoomsModule {
};
exports.RoomsModule = RoomsModule;
exports.RoomsModule = RoomsModule = __decorate([
    (0, common_1.Module)({
        imports: [api_keys_module_1.ApiKeysModule, projects_module_1.ProjectsModule],
        controllers: [rooms_controller_1.RoomsController, dashboard_rooms_controller_1.DashboardRoomsController],
        providers: [rooms_service_1.RoomsService, livekit_room_service_1.LiveKitRoomService],
        exports: [rooms_service_1.RoomsService],
    })
], RoomsModule);
//# sourceMappingURL=rooms.module.js.map