import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeSessionToken } from './decode-token.js';
import { credentialsFilePath, ravenHomeDir } from './paths.js';

/** Token env var — the headless path. Documented in docs/cli.md. */
export const TOKEN_ENV_VAR = 'RAVEN_TOKEN';

export interface StoredCredentials {
  /** Session JWT from the Control API — the CLI just reuses the existing auth, doesn't invent a second one. */
  token: string;
  email: string;
  /** Which API this token is valid for, so a credential from one endpoint can't silently get reused against another. */
  apiUrl: string;
  createdAt: string;
  /**
   * True when the token came from $RAVEN_TOKEN rather than the
   * credentials file. Commands that would otherwise write to disk
   * (`logout`) check this so a CI token isn't mistaken for one the CLI
   * owns and can revoke locally.
   */
  fromEnvironment?: boolean;
}

/**
 * Credentials from $RAVEN_TOKEN, for CI and any other context where no
 * browser exists.
 *
 * The email is decoded from the token purely so `whoami` has something
 * to print; if the token can't be parsed the credential is still
 * returned, because whether it works is the server's call, not ours.
 *
 * `apiUrl` is passed in rather than read here so a single place —
 * readCliConfig() — stays responsible for resolving it from
 * $RAVEN_API_URL, the config file, and the default.
 */
export function credentialsFromEnv(apiUrl: string): StoredCredentials | undefined {
  const token = process.env[TOKEN_ENV_VAR]?.trim();
  if (!token) return undefined;

  return {
    token,
    email: decodeSessionToken(token).email ?? `(token from $${TOKEN_ENV_VAR})`,
    apiUrl,
    createdAt: new Date().toISOString(),
    fromEnvironment: true,
  };
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
