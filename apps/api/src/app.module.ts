import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule, nativeLoggerOptions } from 'nestjs-pino';
import configuration from './shared/config/configuration';
import { validateEnv } from './shared/config/env.validation';
import { CapacityModule } from './shared/capacity/capacity.module';
import { PrismaModule } from './shared/database/prisma.module';
import { OriginsModule } from './shared/origins/origins.module';
import { MetricsMiddleware } from './shared/middleware/metrics.middleware';
import { RequestLoggerMiddleware } from './shared/middleware/request-logger.middleware';
import { RedisModule } from './shared/redis/redis.module';

import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ChatModule } from './modules/chat/chat.module';
import { DashboardWsModule } from './modules/dashboard-ws/dashboard-ws.module';
import { EmailModule } from './modules/email/email.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LiveStreamsModule } from './modules/live-streams/live-streams.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RtcServersModule } from './modules/rtc-servers/rtc-servers.module';
import { RtcTokensModule } from './modules/rtc-tokens/rtc-tokens.module';
import { ServerApiModule } from './modules/server-api/server-api.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { SuperAdminCoreModule } from './modules/super-admin/super-admin-core.module';
import { SuperAdminOverviewModule } from './modules/super-admin/overview/super-admin-overview.module';
import { SuperAdminDevelopersModule } from './modules/super-admin/developers/super-admin-developers.module';
import { SuperAdminActivityModule } from './modules/super-admin/activity/super-admin-activity.module';
import { SuperAdminAuditLogsModule } from './modules/super-admin/audit-logs/super-admin-audit-logs.module';
import { SuperAdminRtcModule } from './modules/super-admin/rtc/super-admin-rtc.module';
import { SuperAdminChatModule } from './modules/super-admin/chat/super-admin-chat.module';
import { SuperAdminLiveModule } from './modules/super-admin/live/super-admin-live.module';
import { SuperAdminApiModule } from './modules/super-admin/api/super-admin-api.module';
import { SuperAdminUsageModule } from './modules/super-admin/usage/super-admin-usage.module';
import { SuperAdminOpsModule } from './modules/super-admin/ops/super-admin-ops.module';
import { UsageModule } from './modules/usage/usage.module';
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
    CapacityModule,
    PrismaModule,
    OriginsModule,
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
    UsageModule,
    SignalingModule,
    MetricsModule,
    ObservabilityModule,
    ServerApiModule,
    WebhooksModule,
    ChatModule,
    DashboardWsModule,
    NotificationsModule,
    LiveStreamsModule,
    IntegrationsModule,
    SuperAdminCoreModule,
    SuperAdminOverviewModule,
    SuperAdminDevelopersModule,
    SuperAdminActivityModule,
    SuperAdminAuditLogsModule,
    SuperAdminRtcModule,
    SuperAdminChatModule,
    SuperAdminLiveModule,
    SuperAdminApiModule,
    SuperAdminUsageModule,
    SuperAdminOpsModule,
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
