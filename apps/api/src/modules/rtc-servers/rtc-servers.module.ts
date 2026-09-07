import { Module } from '@nestjs/common';
import { DashboardRtcServersController } from './dashboard-rtc-servers.controller';
import { SfuRegistrationGuard } from './guards/sfu-registration.guard';
import { RtcServerAllocatorService } from './rtc-server-allocator.service';
import { RtcServerRegistryService } from './rtc-server-registry.service';
import { RtcServersController } from './rtc-servers.controller';

/**
 * The RTC control plane's view of the media plane: which SFUs exist, how
 * healthy they are, and which one serves a given room.
 *
 * Depends on nothing else in the application — Prisma and Redis are both
 * global — which is what lets signaling import it without a cycle.
 */
@Module({
  controllers: [RtcServersController, DashboardRtcServersController],
  providers: [RtcServerRegistryService, RtcServerAllocatorService, SfuRegistrationGuard],
  exports: [RtcServerRegistryService, RtcServerAllocatorService],
})
export class RtcServersModule {}
