import { Command } from 'commander';
import { registerRtcRoomsCommand } from './rooms.js';
import { registerRtcParticipantsCommand } from './participants.js';
import { registerRtcServersCommand } from './servers.js';
import { registerRtcDiagnosticsCommand } from './diagnostics.js';

/**
 * `raven rtc` — the media plane.
 *
 * Deliberately separate from the existing `raven rooms`, which manages
 * control-plane room *records* (create, list, inspect). This group is
 * about what is happening in the media plane right now: which rooms are
 * live, who is connected, which servers are serving them.
 *
 * Everything here goes through the Raven API. The CLI never talks to an
 * RTC server directly — it has no address for one, by design.
 */
export function registerRtcCommand(program: Command): void {
  const rtc = program
    .command('rtc')
    .description('Inspect the RTC media plane — live rooms, participants, and servers');

  registerRtcRoomsCommand(rtc);
  registerRtcParticipantsCommand(rtc);
  registerRtcServersCommand(rtc);
  registerRtcDiagnosticsCommand(rtc);
}
