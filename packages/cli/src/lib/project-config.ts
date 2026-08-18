import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_CONFIG_FILENAME } from './paths.js';

export interface ProjectConfig {
  project: string;
}

/**
 * raven.json in the current working directory — links a local app
 * directory to a Raven project ID. Deliberately contains nothing but the
 * project ID: no secrets, safe to commit to git (Phase 8 spec §16).
 */
export async function readProjectConfig(cwd: string = process.cwd()): Promise<ProjectConfig | undefined> {
  try {
    const raw = await readFile(join(cwd, PROJECT_CONFIG_FILENAME), 'utf8');
    return JSON.parse(raw) as ProjectConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): Promise<string> {
  const path = join(cwd, PROJECT_CONFIG_FILENAME);
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  return path;
}
