import { Global, Module } from '@nestjs/common';
import { ActivityEventsService } from './activity-events.service';
import { AdminAuditService } from './admin-audit.service';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { SuperAdminMeController } from './me.controller';

/**
 * `@Global()`, imported once by `AppModule`, so every super-admin domain
 * module (RTC, Chat, Developers, ...) can inject `PlatformRoleGuard`,
 * `ActivityEventsService`, or `AdminAuditService` without each repeating
 * this import — one module edited per new domain, not two.
 *
 * `AuditModule` follows the same "service only" shape for the same reason
 * documented there: keeping the shared pieces here and the per-domain
 * routes in their own modules avoids forwardRef cycles.
 */
@Global()
@Module({
  controllers: [SuperAdminMeController],
  providers: [PlatformRoleGuard, ActivityEventsService, AdminAuditService],
  exports: [PlatformRoleGuard, ActivityEventsService, AdminAuditService],
})
export class SuperAdminCoreModule {}
