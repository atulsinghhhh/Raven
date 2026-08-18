"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentChatActor = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentChatActor = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.chatActor;
});
//# sourceMappingURL=current-chat-actor.decorator.js.map