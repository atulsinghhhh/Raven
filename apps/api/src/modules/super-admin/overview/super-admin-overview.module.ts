import { Module } from '@nestjs/common';
import { RtcServersModule } from '../../rtc-servers/rtc-servers.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

/**
 * `PrismaService`/`RedisService`/`ConfigService` are all global, and
 * `PlatformRoleGuard` comes from the also-global `SuperAdminCoreModule` —
 * the only non-global dependency this module needs is `RtcServersModule`,
 * for the same `RtcServerRegistryService.listHealthyForProbe` the health
 * check and diagnostics services already use.
 */
@Module({
  imports: [RtcServersModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class SuperAdminOverviewModule {}
