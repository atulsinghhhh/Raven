import { Module } from '@nestjs/common';
import { RoomEventsService } from './room-events.service';

/**
 * The signaling fan-out on its own, for the same reason `SfuLinkModule`
 * exists: two unrelated things need it.
 *
 * The gateway publishes to it constantly. `RoomsService` needs it exactly
 * once — to tell everybody in a room that the room was closed — and
 * importing the whole `SignalingModule` to get at it would drag the
 * WebSocket gateway into modules that have no business starting one.
 *
 * Depends on nothing but `RedisService`, so it cannot participate in a
 * cycle.
 */
@Module({
  providers: [RoomEventsService],
  exports: [RoomEventsService],
})
export class RoomEventsModule {}
