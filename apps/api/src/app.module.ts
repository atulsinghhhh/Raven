import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './shared/config/configuration';
import { validateEnv } from './shared/config/env.validation';
import { PrismaModule } from './shared/database/prisma.module';
import { RequestLoggerMiddleware } from './shared/middleware/request-logger.middleware';
import { RedisModule } from './shared/redis/redis.module';

import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RtcTokensModule } from './modules/rtc-tokens/rtc-tokens.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      // .env lives at the repo root, not in apps/api — that way Docker
      // Compose, this app, and the Prisma CLI all read the same file.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    ApiKeysModule,
    RoomsModule,
    RtcTokensModule,
    SignalingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
