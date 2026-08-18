"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtcTokensModule = void 0;
const common_1 = require("@nestjs/common");
const api_keys_module_1 = require("../api-keys/api-keys.module");
const projects_module_1 = require("../projects/projects.module");
const rooms_module_1 = require("../rooms/rooms.module");
const dashboard_rtc_tokens_controller_1 = require("./dashboard-rtc-tokens.controller");
const rtc_tokens_controller_1 = require("./rtc-tokens.controller");
const rtc_tokens_service_1 = require("./rtc-tokens.service");
let RtcTokensModule = class RtcTokensModule {
};
exports.RtcTokensModule = RtcTokensModule;
exports.RtcTokensModule = RtcTokensModule = __decorate([
    (0, common_1.Module)({
        imports: [api_keys_module_1.ApiKeysModule, projects_module_1.ProjectsModule, rooms_module_1.RoomsModule],
        controllers: [rtc_tokens_controller_1.RtcTokensController, dashboard_rtc_tokens_controller_1.DashboardRtcTokensController],
        providers: [rtc_tokens_service_1.RtcTokensService],
    })
], RtcTokensModule);
//# sourceMappingURL=rtc-tokens.module.js.map