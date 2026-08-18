"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingModule = void 0;
const common_1 = require("@nestjs/common");
const rtc_token_verifier_service_1 = require("./authentication/rtc-token-verifier.service");
const signaling_gateway_1 = require("./gateway/signaling.gateway");
const message_router_service_1 = require("./messages/message-router.service");
const message_validator_service_1 = require("./messages/message-validator.service");
const connection_rate_limit_service_1 = require("./rate-limit/connection-rate-limit.service");
const room_registry_service_1 = require("./rooms/room-registry.service");
let SignalingModule = class SignalingModule {
};
exports.SignalingModule = SignalingModule;
exports.SignalingModule = SignalingModule = __decorate([
    (0, common_1.Module)({
        providers: [
            signaling_gateway_1.SignalingGateway,
            rtc_token_verifier_service_1.RtcTokenVerifierService,
            room_registry_service_1.RoomRegistryService,
            message_validator_service_1.MessageValidatorService,
            message_router_service_1.MessageRouterService,
            connection_rate_limit_service_1.ConnectionRateLimitService,
        ],
        exports: [room_registry_service_1.RoomRegistryService, signaling_gateway_1.SignalingGateway, rtc_token_verifier_service_1.RtcTokenVerifierService],
    })
], SignalingModule);
//# sourceMappingURL=signaling.module.js.map