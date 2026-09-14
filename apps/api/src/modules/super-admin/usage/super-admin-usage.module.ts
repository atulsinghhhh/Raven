import { Module } from '@nestjs/common';
import { SuperAdminUsageController } from './usage.controller';
import { SuperAdminUsageService } from './usage.service';

/**
 * `PrismaService` is global and `AdminAuditService`/`PlatformRoleGuard` are
 * provided/exported by the also-global `SuperAdminCoreModule` — this module
 * only needs to declare its own controller and service, same shape as
 * `SuperAdminActivityModule`/`SuperAdminAuditLogsModule`.
 */
@Module({
  controllers: [SuperAdminUsageController],
  providers: [SuperAdminUsageService],
})
export class SuperAdminUsageModule {}
