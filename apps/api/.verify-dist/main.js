"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const platform_ws_1 = require("@nestjs/platform-ws");
const swagger_1 = require("@nestjs/swagger");
require("reflect-metadata");
const app_module_1 = require("./app.module");
const all_exceptions_filter_1 = require("./shared/errors/all-exceptions.filter");
const signaling_constants_1 = require("./modules/signaling/signaling.constants");
const chat_constants_1 = require("./modules/chat/chat.constants");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const configService = app.get(config_1.ConfigService);
    app.useWebSocketAdapter(new platform_ws_1.WsAdapter(app));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalFilters(new all_exceptions_filter_1.AllExceptionsFilter());
    const corsOrigin = configService.get('cors.origin');
    app.enableCors({
        origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
    });
    const swaggerDocument = swagger_1.SwaggerModule.createDocument(app, new swagger_1.DocumentBuilder()
        .setTitle('Raven Control Plane API')
        .setDescription('Manages developers, projects, API keys, rooms, and RTC tokens. ' +
        'Never carries video/audio media — see docs/control-plane.md. ' +
        'Two separate auth schemes: "jwt" for dashboard-style developer ' +
        'session endpoints (Auth, Projects, API Keys), "apiKey" for the ' +
        'endpoints a developer\'s own backend calls at runtime (Rooms, RTC Tokens).')
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
        .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        description: 'A project API key in the form publicId.secret, e.g. rvk_xxxx.yyyy',
    }, 'apiKey')
        .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        description: 'The same RTC (LiveKit) token minted for this connection — used only by @raven/rtc to authenticate its own best-effort telemetry, never a separate credential.',
    }, 'rtcToken')
        .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        description: 'A short-lived Raven Chat token minted by your backend via POST /v1/chat/tokens. Safe to hand to a browser; scoped to one user and expiring. Never a project API key.',
    }, 'chatToken')
        .build());
    swagger_1.SwaggerModule.setup('docs', app, swaggerDocument);
    const port = configService.get('port');
    await app.listen(port);
    common_1.Logger.log(`Raven control plane listening on port ${port}`, 'Bootstrap');
    common_1.Logger.log(`API documentation available at /docs`, 'Bootstrap');
    common_1.Logger.log(`Signaling WebSocket available at ${signaling_constants_1.SIGNALING_PATH}`, 'Bootstrap');
    common_1.Logger.log(`Chat WebSocket available at ${chat_constants_1.CHAT_PATH}`, 'Bootstrap');
}
bootstrap();
//# sourceMappingURL=main.js.map