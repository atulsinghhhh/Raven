import { credentialsFromEnv, readCredentials, type StoredCredentials } from './auth-store.js';
import { readCliConfig } from './cli-config.js';
import { RavenApiClient } from './api-client.js';
import { notLoggedInError } from './errors.js';

/** An unauthenticated client — for `login`/`register`/`status`'s public /health call. */
export async function getPublicApiClient(): Promise<RavenApiClient> {
  const config = await readCliConfig();
  return new RavenApiClient(config.apiUrl);
}

/**
 * Throws notLoggedInError() if nothing's available. Every command that
 * needs a user goes through this instead of duplicating the check.
 *
 * $RAVEN_TOKEN wins over the credentials file. That ordering is what
 * makes the CLI usable in CI, a container, or over SSH — places where
 * `raven login` has no browser to open — and it also lets a developer
 * run one command as a service account without disturbing their own
 * stored session.
 */
export async function requireCredentials(): Promise<StoredCredentials> {
  const config = await readCliConfig();

  const fromEnv = credentialsFromEnv(config.apiUrl);
  if (fromEnv) return fromEnv;

  const credentials = await readCredentials();
  if (!credentials) throw notLoggedInError();
  return credentials;
}

export async function getAuthenticatedApiClient(): Promise<{ client: RavenApiClient; credentials: StoredCredentials }> {
  const credentials = await requireCredentials();
  return { client: new RavenApiClient(credentials.apiUrl, credentials.token), credentials };
}
