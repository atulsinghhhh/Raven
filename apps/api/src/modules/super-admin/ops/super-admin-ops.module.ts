import { Module } from '@nestjs/common';
import { RtcServersModule } from '../../rtc-servers/rtc-servers.module';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';
import { ErrorsController } from './errors.controller';
import { ErrorsService } from './errors.service';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { SettingsController } from './settings.controller';

/**
 * Bundles five Super Admin Portal sections that don't warrant a module
 * each: Errors (§15), Security (§16), Infrastructure (§17), Admins
 * (§3/§9), Settings (§21). `PrismaService`/`RedisService`/`ConfigService`
 * and `PlatformRoleGuard`/`ActivityEventsService`/`AdminAuditService` are
 * all global (see `SuperAdminCoreModule`) — the only non-global
 * dependency is `RtcServersModule`, for the same
 * `RtcServerRegistryService` the health check, Overview, and dashboard
 * RTC-servers endpoint already share.
 */
@Module({
  imports: [RtcServersModule],
  controllers: [ErrorsController, SecurityController, InfrastructureController, AdminsController, SettingsController],
  providers: [ErrorsService, SecurityService, InfrastructureService, AdminsService],
})
export class SuperAdminOpsModule {}
