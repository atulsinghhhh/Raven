import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ProjectsModule } from '../projects/projects.module';
import { ApiObservabilityController } from './api-observability.controller';
import { ApiProjectController } from './api-project.controller';

/**
 * The API-key-guarded routes that exist specifically for the Phase 10
 * server SDKs (`@corvidhq/server`, `raven-sdk`): "which project am I" plus
 * the Phase 9 observability reads. Everything here delegates to services
 * already built and tested in earlier phases; nothing new is invented,
 * just a second, machine-to-machine entrypoint alongside the existing
 * JWT-guarded dashboard one (the same pattern `RoomsController`/
 * `DashboardRoomsController` already established).
 */
@Module({
  imports: [ApiKeysModule, ProjectsModule, ObservabilityModule],
  controllers: [ApiProjectController, ApiObservabilityController],
})
export class ServerApiModule {}
