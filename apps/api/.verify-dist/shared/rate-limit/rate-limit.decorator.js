"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimit = exports.RATE_LIMIT_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.RATE_LIMIT_KEY = 'rateLimit';
const RateLimit = (limit) => (0, common_1.SetMetadata)(exports.RATE_LIMIT_KEY, limit);
exports.RateLimit = RateLimit;
//# sourceMappingURL=rate-limit.decorator.js.map