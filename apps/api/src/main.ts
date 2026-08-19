import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NativeLogger } from 'nestjs-pino';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { SIGNALING_PATH } from './modules/signaling/signaling.constants';
import { CHAT_PATH } from './modules/chat/chat.constants';

async function bootstrap(): Promise<void> {
  // bufferLogs holds any log calls made before app.useLogger() runs below
  // (module construction, etc.) instead of dropping them or letting them
  // fall through to the default ConsoleLogger.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NativeLogger));
  const configService = app.get(ConfigService);

  // Without this, Nest never calls onModuleDestroy on SIGTERM — the
  // hooks that already exist to drain connections gracefully
  // (ChatGateway/SignalingGateway close every socket with a distinct
  // code instead of an unannounced drop; WebhookDeliveryWorker stops its
  // poll timer; PrismaService/RedisService disconnect cleanly) would
  // otherwise sit unused until Kubernetes's SIGKILL just cuts the
  // process, which is exactly the "hard kill mid-deploy drops every
  // socket on that pod simultaneously" problem a rolling update needs
  // to avoid. Pairing this with a k8s preStop delay (see
  // infrastructure/k8s) gives clients a window to notice the pod
  // leaving the Service's endpoints and start reconnecting elsewhere
  // before this actually runs.
  app.enableShutdownHooks();


  // Signaling shares this same HTTP server/port as a raw WebSocket gateway.
  // Not using the platform-socket.io adapter here on purpose — it wraps
  // its own framing protocol, so clients would need a socket.io client
  // instead of just the browser's native WebSocket API.
  app.useWebSocketAdapter(new WsAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared on the DTO
      forbidNonWhitelisted: true, // reject requests carrying unknown fields
      transform: true, // instantiate DTO classes so defaults/types apply
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigin = configService.get<string>('cors.origin')!;
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
  });

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Raven Control Plane API')
      .setDescription(
        'Manages developers, projects, API keys, rooms, and RTC tokens. ' +
          'Never carries video/audio media — see docs/control-plane.md. ' +
          'Two separate auth schemes: "jwt" for dashboard-style developer ' +
          'session endpoints (Auth, Projects, API Keys), "apiKey" for the ' +
          'endpoints a developer\'s own backend calls at runtime (Rooms, RTC Tokens).',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description: 'A project API key in the form publicId.secret, e.g. rvk_xxxx.yyyy',
        },
        'apiKey',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description:
            'The same RTC (LiveKit) token minted for this connection — used only by @corvidhq/rtc to authenticate its own best-effort telemetry, never a separate credential.',
        },
        'rtcToken',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description:
            'A short-lived Raven Chat token minted by your backend via POST /v1/chat/tokens. Safe to hand to a browser; scoped to one user and expiring. Never a project API key.',
        },
        'chatToken',
      )
      .build(),
  );
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('port')!;
  await app.listen(port);
  Logger.log(`Raven control plane listening on port ${port}`, 'Bootstrap');
  Logger.log(`API documentation available at /docs`, 'Bootstrap');
  Logger.log(`Signaling WebSocket available at ${SIGNALING_PATH}`, 'Bootstrap');
  Logger.log(`Chat WebSocket available at ${CHAT_PATH}`, 'Bootstrap');
}

bootstrap();
