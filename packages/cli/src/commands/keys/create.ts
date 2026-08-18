import { Command } from 'commander';
import chalk from 'chalk';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { resolveProjectId } from '../../lib/project-context.js';
import { printJson, printSuccess } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerKeysCreateCommand(keys: Command): void {
  keys
    .command('create')
    .description('Create a new API key for a project — the secret is shown exactly once')
    .option('-p, --project <project>', 'project ID (overrides the current project context)')
    .option('-n, --name <name>', 'a label for the key')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (opts: { project?: string; name?: string; json?: boolean }) => {
        const projectId = await resolveProjectId(opts.project);
        const { client } = await getAuthenticatedApiClient();
        const created = await client.createApiKey(projectId, { name: opts.name });

        if (opts.json) {
          printJson(created);
          return;
        }

        printSuccess('API key created.');
        process.stdout.write(`\n${chalk.yellow('Save this key now. It will not be shown again.')}\n\n`);
        process.stdout.write(`${chalk.bold(created.key)}\n`);
      }),
    );
}
