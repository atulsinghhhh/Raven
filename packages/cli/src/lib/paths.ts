import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * ~/.raven/ (or $RAVEN_CONFIG_DIR, for tests/CI that need isolation) — the
 * one place the CLI persists anything. See docs/cli.md#configuration.
 */
export function ravenHomeDir(): string {
  return process.env.RAVEN_CONFIG_DIR ?? join(homedir(), '.raven');
}

export function credentialsFilePath(): string {
  return join(ravenHomeDir(), 'credentials.json');
}

export function configFilePath(): string {
  return join(ravenHomeDir(), 'config.json');
}

/** The per-directory project link created by `raven init` — safe to commit. */
export const PROJECT_CONFIG_FILENAME = 'raven.json';
