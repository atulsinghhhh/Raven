import { Module } from '@nestjs/common';
import { SuperAdminAuditLogsController } from './audit-logs.controller';

/**
 * Registers the Admin Audit Logs route. `AdminAuditService` and
 * `PlatformRoleGuard` come from the `@Global()` `SuperAdminCoreModule` —
 * nothing to import here for them.
 */
@Module({
  controllers: [SuperAdminAuditLogsController],
})
export class SuperAdminAuditLogsModule {}
