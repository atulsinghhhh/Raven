import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { credentialsFilePath, ravenHomeDir } from './paths.js';

export interface StoredCredentials {
  /** Session JWT from the Control API — the CLI just reuses the existing auth, doesn't invent a second one. */
  token: string;
  email: string;
  /** Which API this token is valid for, so a credential from one endpoint can't silently get reused against another. */
  apiUrl: string;
  createdAt: string;
}

/**
 * File-based creds under ~/.raven/ — chmod 600 on the file, 700 on the
 * dir. Same fallback most CLIs use instead of pulling in an OS keychain
 * dependency. Never logged, never printed, never in --json output.
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
  // mkdir's mode only applies on creation, so force chmod here in case the
  // dir already existed with looser perms from an older run.
  await chmod(dir, 0o700);
  await chmod(credentialsFilePath(), 0o600);
}

export async function clearCredentials(): Promise<void> {
  await rm(credentialsFilePath(), { force: true });
}

export function ravenHome(): string {
  return ravenHomeDir();
}
