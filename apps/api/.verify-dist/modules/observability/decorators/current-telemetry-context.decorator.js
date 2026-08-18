"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentTelemetryContext = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentTelemetryContext = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.rtcContext;
});
//# sourceMappingURL=current-telemetry-context.decorator.js.map