import { Command } from 'commander';
import { printInfo, printJson } from '../lib/output.js';

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description("Stream developer-facing logs for the current project")
    .option('-f, --follow', 'follow the log stream')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      // The Control API does not expose a developer-safe logs endpoint yet
      // (Phase 8 spec §35 — do not fake logs, and do not build a new
      // logging backend in this phase). This is the honest, permanent
      // answer until that endpoint exists — not a placeholder bug.
      const message = 'Logs are not available for this project yet.';
      if (opts.json) {
        printJson({ available: false, message });
        return;
      }
      printInfo(message);
    });
}
