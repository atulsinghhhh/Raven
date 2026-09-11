import { Command } from 'commander';
import { getAuthenticatedApiClient } from '../../lib/context.js';
import { updateCliConfig } from '../../lib/cli-config.js';
import { printSuccess } from '../../lib/output.js';
import { withErrorHandling } from '../../lib/run.js';

export function registerProjectsUseCommand(projects: Command): void {
  projects
    .command('use <project>')
    .description(
      'Set the current project for subsequent commands (global fallback; see `raven init` for a per-directory link)',
    )
    .action(
      withErrorHandling(async (projectId: string) => {
        const { client } = await getAuthenticatedApiClient();
        // Confirm the ID is real and owned by the caller before saving it.
        // Don't want "current project" pointing at something that 404s the
        // next time somebody uses it.
        const project = await client.getProject(projectId);

        await updateCliConfig({ currentProject: project.id });
        printSuccess(`Using project "${project.name}"`);
      }),
    );
}
