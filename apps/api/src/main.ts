import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { SIGNALING_PATH } from './modules/signaling/signaling.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Signaling (Phase 3) is a raw WebSocket gateway sharing this same HTTP
  // server/port — see docs/signaling.md. Socket.IO's platform-socket.io
  // adapter was deliberately not used: it adds its own framing protocol,
  // which would require a socket.io client instead of a browser's native
  // WebSocket API.
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
      .build(),
  );
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('port')!;
  await app.listen(port);
  Logger.log(`Raven control plane listening on port ${port}`, 'Bootstrap');
  Logger.log(`API documentation available at /docs`, 'Bootstrap');
  Logger.log(`Signaling WebSocket available at ${SIGNALING_PATH}`, 'Bootstrap');
}

bootstrap();
