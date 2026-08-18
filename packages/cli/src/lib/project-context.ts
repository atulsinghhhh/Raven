import { noProjectSelectedError } from './errors.js';
import { readCliConfig } from './cli-config.js';
import { readProjectConfig } from './project-config.js';

/**
 * Precedence, highest first: an explicit --project flag, then this
 * directory's raven.json (from `raven init`), then the global fallback
 * set by `raven projects use` — see docs/cli.md#project-context.
 */
export async function resolveProjectId(explicitProjectId?: string): Promise<string> {
  if (explicitProjectId) return explicitProjectId;

  const projectConfig = await readProjectConfig();
  if (projectConfig?.project) return projectConfig.project;

  const cliConfig = await readCliConfig();
  if (cliConfig.currentProject) return cliConfig.currentProject;

  throw noProjectSelectedError();
}
