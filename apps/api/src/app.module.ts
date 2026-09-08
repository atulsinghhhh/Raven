import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule, nativeLoggerOptions } from 'nestjs-pino';
import configuration from './shared/config/configuration';
import { validateEnv } from './shared/config/env.validation';
import { PrismaModule } from './shared/database/prisma.module';
import { MetricsMiddleware } from './shared/middleware/metrics.middleware';
import { RequestLoggerMiddleware } from './shared/middleware/request-logger.middleware';
import { RedisModule } from './shared/redis/redis.module';

import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ChatModule } from './modules/chat/chat.module';
import { EmailModule } from './modules/email/email.module';
import { HealthModule } from './modules/health/health.module';
import { LiveStreamsModule } from './modules/live-streams/live-streams.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RtcServersModule } from './modules/rtc-servers/rtc-servers.module';
import { RtcTokensModule } from './modules/rtc-tokens/rtc-tokens.module';
import { ServerApiModule } from './modules/server-api/server-api.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      // .env lives at the repo root, not in apps/api: that way Docker
      // Compose, this app, and the Prisma CLI all read the same file.
      envFilePath: ['../../.env', '.env'],
    }),
    // NativeLogger (main.ts) makes every existing `new Logger(name)` call
    // across the app, no call sites changed, emit pino JSON instead of
    // ConsoleLogger's human-formatted text, so log aggregators can parse
    // fields instead of regexing lines. autoLogging is off because
    // RequestLoggerMiddleware already emits one guaranteed line per
    // request (with the correlation id the error filter and audit log
    // also depend on); turning this on too would double every request.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          ...nativeLoggerOptions,
          level: config.get<string>('logging.level'),
          autoLogging: false,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    EmailModule,
    HealthModule,
    UsersModule,
    AuthModule,
    OnboardingModule,
    AuditModule,
    ProjectsModule,
    ApiKeysModule,
    RoomsModule,
    RtcServersModule,
    RtcTokensModule,
    SignalingModule,
    MetricsModule,
    ObservabilityModule,
    ServerApiModule,
    WebhooksModule,
    ChatModule,
    LiveStreamsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // MetricsMiddleware before RequestLoggerMiddleware doesn't matter;
    // both attach their own res.on('finish') listener, and Express fires
    // every listener registered on the same event regardless of which
    // middleware happened to run first.
    consumer.apply(RequestLoggerMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
