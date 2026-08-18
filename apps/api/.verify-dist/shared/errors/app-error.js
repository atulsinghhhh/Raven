"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TooManyRequestsError = exports.ValidationFailedError = exports.UnauthorizedError = exports.ConflictError = exports.ForbiddenError = exports.NotFoundError = exports.AppError = void 0;
const common_1 = require("@nestjs/common");
class AppError extends common_1.HttpException {
    constructor(message, status, code, details) {
        super({ message, code, ...details }, status);
    }
}
exports.AppError = AppError;
class NotFoundError extends AppError {
    constructor(resource) {
        super(`${resource} not found`, common_1.HttpStatus.NOT_FOUND, 'NOT_FOUND');
    }
}
exports.NotFoundError = NotFoundError;
class ForbiddenError extends AppError {
    constructor(message = 'You do not have access to this resource') {
        super(message, common_1.HttpStatus.FORBIDDEN, 'FORBIDDEN');
    }
}
exports.ForbiddenError = ForbiddenError;
class ConflictError extends AppError {
    constructor(message) {
        super(message, common_1.HttpStatus.CONFLICT, 'CONFLICT');
    }
}
exports.ConflictError = ConflictError;
class UnauthorizedError extends AppError {
    constructor(message = 'Invalid or missing credentials') {
        super(message, common_1.HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED');
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ValidationFailedError extends AppError {
    constructor(message) {
        super(message, common_1.HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
}
exports.ValidationFailedError = ValidationFailedError;
class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests — please try again later') {
        super(message, common_1.HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED');
    }
}
exports.TooManyRequestsError = TooManyRequestsError;
//# sourceMappingURL=app-error.js.map