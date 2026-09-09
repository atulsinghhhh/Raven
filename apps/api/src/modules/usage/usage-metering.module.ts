import { Module } from '@nestjs/common';
import { UsageAllowanceService } from './usage-allowance.service';
import { UsageMeterService } from './usage-meter.service';

/**
 * The metering services on their own, with no HTTP surface and no module
 * dependencies beyond the global Prisma and Config modules.
 *
 * Split out of `UsageModule` for the same reason `RtcTokenSignerModule` is
 * split out of `RtcTokensModule`: the consumers form a cycle otherwise.
 * `AuthModule` provisions an allowance at registration, and
 * `UsageModule`'s controller needs `ProjectsService` to authorize a
 * project-scoped read — but `ProjectsModule` already imports `AuthModule`.
 * Keeping the services in a dependency-free module lets auth, RTC tokens
 * and signaling all import them without dragging the controller's
 * dependencies along.
 */
@Module({
  providers: [UsageAllowanceService, UsageMeterService],
  exports: [UsageAllowanceService, UsageMeterService],
})
export class UsageMeteringModule {}
