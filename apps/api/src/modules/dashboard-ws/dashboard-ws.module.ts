import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DashboardWsTokensController } from './dashboard-ws-tokens.controller';
import { DashboardWsGateway } from './gateway/dashboard-ws.gateway';
import { DashboardWsConnectionRateLimitService } from './rate-limit/dashboard-ws-connection-rate-limit.service';
import { DashboardEventsService } from './realtime/dashboard-events.service';
import { DashboardWsTokenService } from './tokens/dashboard-ws-token.service';

/**
 * The dashboard realtime transport foundation (Phase 5B). Entirely
 * separate from ChatModule and SignalingModule, same reasoning ChatModule
 * gives for staying apart from SignalingModule: different consumer,
 * different token, different event vocabulary, and either can fail
 * without taking the others down.
 *
 * No product module currently imports this one — Phase 5B introduces no
 * event producer. A later phase (5C+) that wants to publish onto
 * DashboardEventsService imports this module for it, the same way
 * RoomEventsModule is imported by RoomsService today.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [DashboardWsTokensController],
  providers: [
    DashboardWsTokenService,
    DashboardEventsService,
    DashboardWsConnectionRateLimitService,
    DashboardWsGateway,
  ],
  // DashboardWsGateway exported for MetricsService (Phase 6H) — same
  // "gateway is a metrics source, not just a message pump" reasoning
  // ChatModule/SignalingModule already export their own gateways for.
  exports: [DashboardEventsService, DashboardWsGateway],
})
export class DashboardWsModule {}
