import { homedir } from 'node:os';
import { join } from 'node:path';

/** ~/.raven/, or $RAVEN_CONFIG_DIR for isolated tests and CI. The only place the CLI writes anything. */
export function ravenHomeDir(): string {
  return process.env.RAVEN_CONFIG_DIR ?? join(homedir(), '.raven');
}

export function credentialsFilePath(): string {
  return join(ravenHomeDir(), 'credentials.json');
}

export function configFilePath(): string {
  return join(ravenHomeDir(), 'config.json');
}

/** The per-directory project link `raven init` creates. Safe to commit. */
export const PROJECT_CONFIG_FILENAME = 'raven.json';
