import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { credentialsFilePath, ravenHomeDir } from './paths.js';

export interface StoredCredentials {
  /** The Control API's own session JWT — the CLI reuses the existing auth system verbatim, never a separate one. */
  token: string;
  email: string;
  /** Which API this token is valid for — keeps a credential from one endpoint being silently reused against another. */
  apiUrl: string;
  createdAt: string;
}

/**
 * File-based credential storage under ~/.raven/, chmod 600 (owner
 * read/write only) immediately on write, directory chmod 700 — the same
 * fallback most CLIs use when not integrating with an OS keychain (no
 * native keychain dependency here, see docs/cli.md#known-limitations).
 * Never logged, never printed, never included in --json output.
 */
export async function readCredentials(): Promise<StoredCredentials | undefined> {
  try {
    const raw = await readFile(credentialsFilePath(), 'utf8');
    return JSON.parse(raw) as StoredCredentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeCredentials(credentials: StoredCredentials): Promise<void> {
  const dir = dirname(credentialsFilePath());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(credentialsFilePath(), JSON.stringify(credentials, null, 2), { mode: 0o600 });
  // mkdir's `mode` is only honored on creation — force it in case the
  // directory already existed with looser permissions from an older run.
  await chmod(dir, 0o700);
  await chmod(credentialsFilePath(), 0o600);
}

export async function clearCredentials(): Promise<void> {
  await rm(credentialsFilePath(), { force: true });
}

export function ravenHome(): string {
  return ravenHomeDir();
}
