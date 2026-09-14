import { Module } from '@nestjs/common';
import { DevelopersController } from './developers.controller';
import { DevelopersService } from './developers.service';

/**
 * `PrismaService`, `PlatformRoleGuard`, `ActivityEventsService`, and
 * `AdminAuditService` are all global (`SuperAdminCoreModule`) — this
 * module only needs to register its own controller and service, same
 * shape as `SuperAdminOverviewModule`.
 */
@Module({
  controllers: [DevelopersController],
  providers: [DevelopersService],
})
export class SuperAdminDevelopersModule {}
