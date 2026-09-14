import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

/**
 * `PrismaService` is global (`PrismaModule`) and `PlatformRoleGuard` comes
 * from the also-global `SuperAdminCoreModule` — this module needs no
 * imports of its own, same shape as `SuperAdminOverviewModule` minus its
 * one extra dependency on `RtcServersModule`.
 */
@Module({
  controllers: [LiveController],
  providers: [LiveService],
})
export class SuperAdminLiveModule {}
