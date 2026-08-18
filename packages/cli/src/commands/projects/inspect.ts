import { Command } from 'commander';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { printField, printJson } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerProjectsInspectCommand(projects: Command): void {
  projects
    .command('inspect <project>')
    .description('Show details for a Raven project')
    .option('--json', 'output as JSON')
    .action(
      withErrorHandling(async (projectId: string, opts: { json?: boolean }) => {
        const { client } = await getAuthenticatedApiClient();
        const project = await client.getProject(projectId);

        if (opts.json) {
          printJson(project);
          return;
        }

        printField('Name', project.name);
        printField('ID', project.id);
        printField('Environment', 'development');
        // no per-project RTC endpoint yet — everything shares one Control
        // API / LiveKit deployment. `raven init` has the real token-mint flow.
        printField('RTC endpoint', 'See `raven init` for SDK setup');
        printField('Status', project.status);
        printField('Created', new Date(project.createdAt).toLocaleString());
      }),
    );
}
