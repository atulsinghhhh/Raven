"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentProjectId = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentProjectId = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiProjectId;
});
//# sourceMappingURL=current-project-id.decorator.js.map