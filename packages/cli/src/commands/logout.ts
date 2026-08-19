import { Command } from 'commander';
import { clearCredentials, readCredentials, TOKEN_ENV_VAR } from '../lib/auth-store.js';
import { RavenApiClient } from '../lib/api-client.js';
import { printSuccess, printInfo } from '../lib/output.js';
import { withErrorHandling } from '../lib/run.js';

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Sign out and remove locally stored Raven credentials')
    .action(
      withErrorHandling(async () => {
        const credentials = await readCredentials();
        const envToken = Boolean(process.env[TOKEN_ENV_VAR]?.trim());

        if (!credentials) {
          // Saying "logged out" while $RAVEN_TOKEN is still set would be
          // false — the next command would authenticate perfectly well.
          printInfo(
            envToken
              ? `No stored credentials to remove, but $${TOKEN_ENV_VAR} is set — unset it to sign out of this shell.`
              : 'Already logged out.',
          );
          return;
        }

        // best-effort server-side blocklist — local creds get cleared
        // regardless, so "logged out" here never waits on the network
        await new RavenApiClient(credentials.apiUrl, credentials.token).logout().catch(() => undefined);

        await clearCredentials();
        printSuccess('Logged out.');

        if (envToken) {
          printInfo(`$${TOKEN_ENV_VAR} is still set and takes precedence — unset it to finish signing out.`);
        }
      }),
    );
}
