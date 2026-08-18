"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const configuration_1 = __importDefault(require("./shared/config/configuration"));
const env_validation_1 = require("./shared/config/env.validation");
const prisma_module_1 = require("./shared/database/prisma.module");
const request_logger_middleware_1 = require("./shared/middleware/request-logger.middleware");
const redis_module_1 = require("./shared/redis/redis.module");
const api_keys_module_1 = require("./modules/api-keys/api-keys.module");
const auth_module_1 = require("./modules/auth/auth.module");
const chat_module_1 = require("./modules/chat/chat.module");
const health_module_1 = require("./modules/health/health.module");
const observability_module_1 = require("./modules/observability/observability.module");
const projects_module_1 = require("./modules/projects/projects.module");
const rooms_module_1 = require("./modules/rooms/rooms.module");
const rtc_tokens_module_1 = require("./modules/rtc-tokens/rtc-tokens.module");
const server_api_module_1 = require("./modules/server-api/server-api.module");
const signaling_module_1 = require("./modules/signaling/signaling.module");
const users_module_1 = require("./modules/users/users.module");
const webhooks_module_1 = require("./modules/webhooks/webhooks.module");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(request_logger_middleware_1.RequestLoggerMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                validate: env_validation_1.validateEnv,
                envFilePath: ['../../.env', '.env'],
            }),
            prisma_module_1.PrismaModule,
            redis_module_1.RedisModule,
            health_module_1.HealthModule,
            users_module_1.UsersModule,
            auth_module_1.AuthModule,
            projects_module_1.ProjectsModule,
            api_keys_module_1.ApiKeysModule,
            rooms_module_1.RoomsModule,
            rtc_tokens_module_1.RtcTokensModule,
            signaling_module_1.SignalingModule,
            observability_module_1.ObservabilityModule,
            server_api_module_1.ServerApiModule,
            webhooks_module_1.WebhooksModule,
            chat_module_1.ChatModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map