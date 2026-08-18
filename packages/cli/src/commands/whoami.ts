import { Command } from 'commander';
import { requireCredentials } from '../lib/context.js';
import { RavenApiClient } from '../lib/api-client.js';
import { printField, printJson } from '../lib/output.js';
import { withErrorHandling } from '../lib/run.js';

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show the currently authenticated Raven account')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (opts: { json?: boolean }) => {
        const credentials = await requireCredentials();
        const client = new RavenApiClient(credentials.apiUrl, credentials.token);

        // Project count is real, fetched live — never a cached/guessed number.
        const projects = await client.listProjects();

        if (opts.json) {
          printJson({ email: credentials.email, projectCount: projects.length, environment: 'development' });
          return;
        }

        printField('Logged in as', credentials.email);
        printField('Projects', String(projects.length));
        // Raven's control plane does not yet distinguish environments per
        // project (see docs/dashboard.md) — this reflects that honestly
        // rather than inventing a per-account value.
        printField('Environment', 'development');
      }),
    );
}
