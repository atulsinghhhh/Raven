"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcryptjs"));
const crypto_1 = require("crypto");
const app_error_1 = require("../../shared/errors/app-error");
const redis_service_1 = require("../../shared/redis/redis.service");
const users_service_1 = require("../users/users.service");
const PASSWORD_SALT_ROUNDS = 12;
const REVOCATION_KEY_PREFIX = 'auth:revoked-jti:';
let AuthService = class AuthService {
    constructor(usersService, jwtService, configService, redisService) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.configService = configService;
        this.redisService = redisService;
    }
    async register(dto) {
        const existing = await this.usersService.findByEmail(dto.email);
        if (existing) {
            throw new app_error_1.ConflictError('An account with this email already exists');
        }
        const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
        const user = await this.usersService.create({
            email: dto.email,
            passwordHash,
            name: dto.name,
        });
        return this.issueToken(user.id, user.email, user.name);
    }
    async login(dto) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new app_error_1.UnauthorizedError('Invalid email or password');
        }
        const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
        if (!passwordMatches) {
            throw new app_error_1.UnauthorizedError('Invalid email or password');
        }
        return this.issueToken(user.id, user.email, user.name);
    }
    async logout(user) {
        const ttlSeconds = Math.max(user.exp - Math.floor(Date.now() / 1000), 1);
        await this.redisService.client.set(`${REVOCATION_KEY_PREFIX}${user.jti}`, '1', 'EX', ttlSeconds);
    }
    async isRevoked(jti) {
        const value = await this.redisService.client.get(`${REVOCATION_KEY_PREFIX}${jti}`);
        return value !== null;
    }
    async issueToken(userId, email, name) {
        const payload = { sub: userId, email, jti: (0, crypto_1.randomUUID)() };
        const expiresIn = this.configService.get('jwt.expiresIn');
        const accessToken = this.jwtService.sign(payload, { expiresIn });
        return { accessToken, expiresIn, user: { id: userId, email, name } };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService,
        config_1.ConfigService,
        redis_service_1.RedisService])
], AuthService);
//# sourceMappingURL=auth.service.js.map