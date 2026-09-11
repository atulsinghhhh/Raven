import { Command } from 'commander';
import { registerRtcRoomsCommand } from './rooms.js';
import { registerRtcParticipantsCommand } from './participants.js';
import { registerRtcServersCommand } from './servers.js';
import { registerRtcDiagnosticsCommand } from './diagnostics.js';

/**
 * `raven rtc`: the media plane.
 *
 * Kept separate from `raven rooms`, which manages control-plane room
 * *records* (create, list, inspect). This group is about what's happening in
 * the media plane right now: which rooms are live, who's connected, which
 * servers are serving them.
 *
 * Everything goes through the Livqeno API. The CLI never talks to an RTC
 * server directly; by design it has no address for one.
 */
export function registerRtcCommand(program: Command): void {
  const rtc = program.command('rtc').description('Inspect the RTC media plane; live rooms, participants, and servers');

  registerRtcRoomsCommand(rtc);
  registerRtcParticipantsCommand(rtc);
  registerRtcServersCommand(rtc);
  registerRtcDiagnosticsCommand(rtc);
}
