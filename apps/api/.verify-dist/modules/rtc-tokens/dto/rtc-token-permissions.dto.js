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
exports.RtcTokenPermissionsDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class RtcTokenPermissionsDto {
    constructor() {
        this.join = true;
        this.subscribe = true;
        this.publish = false;
        this.publishAudio = false;
        this.publishVideo = false;
        this.publishData = false;
    }
}
exports.RtcTokenPermissionsDto = RtcTokenPermissionsDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true, description: 'Allowed to join the room at all' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "join", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true, description: 'Allowed to subscribe to other participants\' tracks' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "subscribe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false, description: 'Allowed to publish any track at all' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "publish", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false, description: 'Restricts publish to audio (microphone) — only meaningful when publish=true' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "publishAudio", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false, description: 'Restricts publish to video (camera) — only meaningful when publish=true' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "publishVideo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false, description: 'Allowed to send/receive WebRTC data channel messages' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RtcTokenPermissionsDto.prototype, "publishData", void 0);
//# sourceMappingURL=rtc-token-permissions.dto.js.map