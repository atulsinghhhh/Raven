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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const rate_limit_decorator_1 = require("../../shared/rate-limit/rate-limit.decorator");
const rate_limit_guard_1 = require("../../shared/rate-limit/rate-limit.guard");
const auth_service_1 = require("./auth.service");
const current_user_decorator_1 = require("./decorators/current-user.decorator");
const login_dto_1 = require("./dto/login.dto");
const register_dto_1 = require("./dto/register.dto");
const jwt_auth_guard_1 = require("./guards/jwt-auth.guard");
const AUTH_RESULT_EXAMPLE = {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    expiresIn: '12h',
    user: { id: 'e975bab7-93ba-48ef-8e45-d47d29bece07', email: 'dev@example.com', name: null },
};
let AuthController = class AuthController {
    constructor(authService) {
        this.authService = authService;
    }
    register(dto) {
        return this.authService.register(dto);
    }
    login(dto) {
        return this.authService.login(dto);
    }
    async logout(user) {
        await this.authService.logout(user);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(5),
    (0, swagger_1.ApiOperation)({
        summary: 'Create a developer account',
        description: 'Rate limited to 5 requests/window/IP. Passwords are hashed with bcrypt — never stored or logged in plaintext.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Account created', schema: { example: AUTH_RESULT_EXAMPLE } }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'An account with this email already exists' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(10),
    (0, swagger_1.ApiOperation)({ summary: 'Exchange email/password for a session JWT', description: 'Rate limited to 10 requests/window/IP.' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Authenticated', schema: { example: AUTH_RESULT_EXAMPLE } }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: 'Invalid email or password' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, swagger_1.ApiOperation)({
        summary: 'Invalidate the current session JWT',
        description: 'Blocklists this specific token (by jti) in Redis until it would have expired naturally. JWTs are stateless, so this is the only way to make one stop working before its exp claim.',
    }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Logged out' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('Auth'),
    (0, common_1.Controller)('v1/auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map