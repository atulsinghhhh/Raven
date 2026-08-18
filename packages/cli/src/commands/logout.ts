import { Command } from 'commander';
import { clearCredentials, readCredentials } from '../lib/auth-store.js';
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
        if (!credentials) {
          printInfo('Already logged out.');
          return;
        }

        // best-effort server-side blocklist — local creds get cleared
        // regardless, so "logged out" here never waits on the network
        await new RavenApiClient(credentials.apiUrl, credentials.token).logout().catch(() => undefined);

        await clearCredentials();
        printSuccess('Logged out.');
      }),
    );
}
