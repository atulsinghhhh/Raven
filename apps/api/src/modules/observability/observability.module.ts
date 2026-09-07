import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SignalingModule } from '../signaling/signaling.module';
import { ConnectionsService } from './connections.service';
import { DashboardObservabilityController } from './dashboard-observability.controller';
import { DiagnosticsService } from './diagnostics.service';
import { ErrorsService } from './errors.service';
import { TelemetryIngestGuard } from './guards/telemetry-ingest.guard';
import { MetricsService } from './metrics.service';
import { RetentionService } from './retention.service';
import { TelemetryController } from './telemetry.controller';

@Module({
  imports: [ProjectsModule, SignalingModule, RtcServersModule],
  controllers: [TelemetryController, DashboardObservabilityController],
  providers: [
    ConnectionsService,
    ErrorsService,
    MetricsService,
    DiagnosticsService,
    RetentionService,
    TelemetryIngestGuard,
  ],
  exports: [ConnectionsService, ErrorsService, MetricsService, DiagnosticsService],
})
export class ObservabilityModule {}
