import { Global, Module } from '@nestjs/common';
import { ProjectOriginGuard } from './project-origin.guard';
import { ProjectOriginService } from './project-origin.service';

/**
 * Global, because the origin policy is consulted from three unrelated
 * places — the telemetry controller, the chat REST controllers, and both
 * WebSocket gateways — and threading an import through each of their
 * modules would say nothing useful about the dependency.
 */
@Global()
@Module({
  providers: [ProjectOriginService, ProjectOriginGuard],
  exports: [ProjectOriginService, ProjectOriginGuard],
})
export class OriginsModule {}
