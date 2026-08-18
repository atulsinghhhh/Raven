import { Command } from 'commander';
import { printInfo, printJson } from '../lib/output.js';

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description("Stream developer-facing logs for the current project")
    .option('-f, --follow', 'follow the log stream')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      // no developer-safe logs endpoint on the Control API yet. This is the
      // real answer until one ships — not a bug, not a placeholder.
      const message = 'Logs are not available for this project yet.';
      if (opts.json) {
        printJson({ available: false, message });
        return;
      }
      printInfo(message);
    });
}
