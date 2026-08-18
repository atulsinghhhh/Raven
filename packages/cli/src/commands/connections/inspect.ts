import { Command } from 'commander';
import chalk from 'chalk';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { resolveProjectId } from '../../lib/project-context.js';
import { printField, printJson } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerConnectionsInspectCommand(connections: Command): void {
  connections
    .command('inspect <connectionId>')
    .description('Show one connection\'s full detail and event timeline')
    .option('-p, --project <project>', 'project ID (overrides the current project context)')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (connectionId: string, opts: { project?: string; json?: boolean }) => {
        const projectId = await resolveProjectId(opts.project);
        const { client } = await getAuthenticatedApiClient();
        const connection = await client.getConnection(projectId, connectionId);

        if (opts.json) {
          printJson(connection);
          return;
        }

        process.stdout.write(`${chalk.bold(connection.publicId)}\n\n`);
        printField('Room', connection.roomName);
        printField('Participant', connection.participantIdentity);
        printField('State', connection.state);
        printField('Reconnect count', String(connection.reconnectCount));
        printField('SDK', connection.sdkVersion ?? 'unknown');
        printField('Platform', [connection.platform, connection.browser].filter(Boolean).join(' / ') || 'unknown');
        if (connection.region) printField('Region', connection.region);
        printField('Started', new Date(connection.startedAt).toLocaleString());
        if (connection.connectedAt) printField('Connected', new Date(connection.connectedAt).toLocaleString());
        if (connection.disconnectedAt) printField('Disconnected', new Date(connection.disconnectedAt).toLocaleString());
        if (connection.durationMs !== null) printField('Duration', formatDuration(connection.durationMs));
        if (connection.disconnectReason) printField('Disconnect reason', connection.disconnectReason);

        if (connection.errors.length > 0) {
          process.stdout.write(`\n${chalk.bold('Errors:')}\n\n`);
          for (const error of connection.errors) {
            process.stdout.write(`${chalk.red(error.category)} — ${error.message}\n`);
            if (error.suggestedAction) process.stdout.write(`  ${chalk.dim(`Suggestion: ${error.suggestedAction}`)}\n`);
          }
        }

        process.stdout.write(`\n${chalk.bold('Timeline:')}\n\n`);
        for (const event of connection.events) {
          process.stdout.write(`${chalk.dim(new Date(event.timestamp).toLocaleTimeString())}  ${event.type}\n`);
        }
      }),
    );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
