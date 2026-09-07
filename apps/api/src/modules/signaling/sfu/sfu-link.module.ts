import { Module } from '@nestjs/common';
import { SfuLinkService } from './sfu-link.service';

/**
 * The node link on its own.
 *
 * A separate module because two unrelated things need it: signaling, to
 * relay negotiation, and the rooms/live-streams services, to ask a node
 * what is actually happening in a room. Importing the whole
 * `SignalingModule` for the latter would pull the WebSocket gateway into
 * modules that have no business starting one.
 *
 * Depends on nothing but `ConfigService`, so it cannot participate in a
 * cycle.
 */
@Module({
  providers: [SfuLinkService],
  exports: [SfuLinkService],
})
export class SfuLinkModule {}
