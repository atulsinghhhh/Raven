import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DashboardUsageController } from './dashboard-usage.controller';
import { UsageMeteringModule } from './usage-metering.module';

/**
 * The developer-facing usage surface: `/v1/usage`, `/v1/usage/detail` and
 * `/v1/projects/:projectId/usage`.
 *
 * Read-only. There is deliberately no grant, adjust, reset or transfer
 * endpoint — those are Admin Portal operations, and the Admin Portal does
 * not exist yet. See docs/usage-metering.md#what-this-phase-does-not-include.
 *
 * The metering itself lives in `UsageMeteringModule`, which this imports
 * and re-exports so a consumer only has to know about one of the two.
 */
@Module({
  imports: [UsageMeteringModule, ProjectsModule],
  controllers: [DashboardUsageController],
  exports: [UsageMeteringModule],
})
export class UsageModule {}
