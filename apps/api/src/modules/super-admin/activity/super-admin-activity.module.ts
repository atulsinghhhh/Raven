import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';

/**
 * `ActivityEventsService` is provided/exported by `SuperAdminCoreModule`
 * (`@Global()`, already registered in `AppModule`), so it just gets
 * injected into `ActivityController` here — no providers array entry
 * needed for a pure passthrough+validation controller.
 */
@Module({
  controllers: [ActivityController],
})
export class SuperAdminActivityModule {}
