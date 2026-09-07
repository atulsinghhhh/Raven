import { Command } from 'commander';
import chalk from 'chalk';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { resolveProjectId } from '../../lib/project-context.js';
import { printEmpty, printField, printJson } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerRtcDiagnosticsCommand(rtc: Command): void {
  rtc
    .command('diagnostics <room>')
    .description('Diagnose one room: which server serves it, who is on it, what they publish')
    .option('-p, --project <project>', 'project ID (overrides the current project context)')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (roomId: string, opts: { project?: string; json?: boolean }) => {
        const projectId = await resolveProjectId(opts.project);
        const { client } = await getAuthenticatedApiClient();

        // The fleet view alongside the room's own state: "this room looks
        // dead" and "the whole fleet is down" need different responses,
        // and one command answering both saves the second round trip.
        const [room, fleet] = await Promise.all([
          client.getRoom(projectId, roomId),
          client.getRtcFleetMetrics().catch(() => null),
        ]);

        if (opts.json) {
          printJson({ room, fleet });
          return;
        }

        process.stdout.write(`${chalk.bold(`Diagnostics: ${room.name}`)}\n\n`);
        printField('Room ID', room.id);
        printField('Status', room.status);

        if (fleet) {
          printField(
            'Fleet',
            `${fleet.healthyServers} healthy of ${fleet.servers} · ${fleet.activeRooms}/${fleet.capacity} rooms`,
          );
          if (fleet.healthyServers === 0) {
            process.stdout.write(
              `\n${chalk.red(
                'No healthy RTC server is registered — no room can be served until one is.',
              )}\n`,
            );
            return;
          }
        }

        if (room.liveParticipants === null) {
          process.stdout.write('\n');
          printEmpty(
            'The RTC server serving this room could not be reached.',
            'The call may still be running. Check: raven rtc servers list',
          );
          return;
        }

        printField('Live participants', String(room.liveParticipants.length));

        if (room.liveParticipants.length === 0) {
          process.stdout.write('\n');
          printEmpty(
            'The room is idle — nobody is connected.',
            'A room is only assigned a server while someone is in it.',
          );
          return;
        }

        let audio = 0;
        let video = 0;
        let screen = 0;
        let muted = 0;
        for (const participant of room.liveParticipants) {
          for (const track of participant.tracks) {
            if (track.muted) muted++;
            if (track.name === 'screenShare') screen++;
            else if (track.kind === 'audio') audio++;
            else if (track.kind === 'video') video++;
          }
        }

        printField('Tracks', `${audio} audio · ${video} video · ${screen} screen`);
        if (muted > 0) {
          printField('Muted tracks', String(muted));
        }

        process.stdout.write(`\n${chalk.dim('Participants:')}\n\n`);
        for (const participant of room.liveParticipants) {
          const detail =
            participant.tracks.length === 0
              ? chalk.yellow('publishing nothing')
              : participant.tracks
                  .map((track) => `${track.name}${track.muted ? chalk.dim('(muted)') : ''}`)
                  .join(' ');
          process.stdout.write(`  ${chalk.bold(participant.identity.padEnd(20))} ${detail}\n`);
        }

        // Per-participant RTT/jitter/loss come from SDK telemetry rather
        // than the media plane's own view; `raven connections` is where
        // that lives. Saying so beats leaving a gap the reader has to
        // guess at.
        process.stdout.write(
          `\n${chalk.dim('For per-connection RTT, jitter and packet loss: raven connections list')}\n`,
        );
      }),
    );
}
