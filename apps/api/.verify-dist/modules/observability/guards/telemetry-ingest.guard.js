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
exports.TelemetryIngestGuard = void 0;
const common_1 = require("@nestjs/common");
const app_error_1 = require("../../../shared/errors/app-error");
const rtc_token_verifier_service_1 = require("../../signaling/authentication/rtc-token-verifier.service");
let TelemetryIngestGuard = class TelemetryIngestGuard {
    constructor(tokenVerifier) {
        this.tokenVerifier = tokenVerifier;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const header = request.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        try {
            request.rtcContext = await this.tokenVerifier.verify(token ?? '');
        }
        catch {
            throw new app_error_1.UnauthorizedError('Invalid or expired RTC token');
        }
        return true;
    }
};
exports.TelemetryIngestGuard = TelemetryIngestGuard;
exports.TelemetryIngestGuard = TelemetryIngestGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rtc_token_verifier_service_1.RtcTokenVerifierService])
], TelemetryIngestGuard);
//# sourceMappingURL=telemetry-ingest.guard.js.map