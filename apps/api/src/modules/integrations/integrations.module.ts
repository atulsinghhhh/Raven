import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { ProjectsModule } from '../projects/projects.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [ProjectsModule, ObservabilityModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
