import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiOpsService } from './api.service';

/**
 * `PlatformRoleGuard` and `ActivityEventsService` are provided/exported by
 * `SuperAdminCoreModule` (`@Global()`, already registered in `AppModule`),
 * so only this domain's own controller+service need registering here.
 */
@Module({
  controllers: [ApiController],
  providers: [ApiOpsService],
})
export class SuperAdminApiModule {}
