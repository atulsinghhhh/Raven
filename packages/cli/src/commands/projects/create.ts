import { Command } from 'commander';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { printField, printJson, printSuccess } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerProjectsCreateCommand(projects: Command): void {
  projects
    .command('create <name>')
    .description('Create a new Raven project')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (name: string, opts: { json?: boolean }) => {
        const { client } = await getAuthenticatedApiClient();
        const project = await client.createProject({ name });

        if (opts.json) {
          printJson(project);
          return;
        }

        printSuccess('Project created');
        process.stdout.write('\n');
        printField('Project', project.name);
        printField('Project ID', project.id);
        // See docs/dashboard.md#environments — Raven's control plane
        // doesn't yet issue distinct per-environment credentials, so this
        // is a fixed label, not a fabricated per-project value.
        printField('Environment', 'development');
      }),
    );
}
