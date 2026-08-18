import { readCredentials, type StoredCredentials } from './auth-store.js';
import { readCliConfig } from './cli-config.js';
import { RavenApiClient } from './api-client.js';
import { notLoggedInError } from './errors.js';

/** An unauthenticated client — for `login`/`register`/`status`'s public /health call. */
export async function getPublicApiClient(): Promise<RavenApiClient> {
  const config = await readCliConfig();
  return new RavenApiClient(config.apiUrl);
}

/** Throws notLoggedInError() if nothing's stored. Every command that needs a user goes through this instead of duplicating the check. */
export async function requireCredentials(): Promise<StoredCredentials> {
  const credentials = await readCredentials();
  if (!credentials) throw notLoggedInError();
  return credentials;
}

export async function getAuthenticatedApiClient(): Promise<{ client: RavenApiClient; credentials: StoredCredentials }> {
  const credentials = await requireCredentials();
  return { client: new RavenApiClient(credentials.apiUrl, credentials.token), credentials };
}
