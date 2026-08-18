import { Command } from 'commander';
import open from 'open';
import chalk from 'chalk';
import { startBrowserLoginServer } from '../lib/browser-login-server.js';
import { writeCredentials } from '../lib/auth-store.js';
import { readCliConfig } from '../lib/cli-config.js';
import { printSuccess } from '../lib/output.js';
import { withErrorHandling } from '../lib/run.js';
import { CliError } from '../lib/errors.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Authenticate with Raven via your browser')
    .option('--no-open', "print the login URL instead of opening a browser automatically")
    .action(
      withErrorHandling(async (options: { open: boolean }) => {
        const config = await readCliConfig();
        const { port, state, result } = startBrowserLoginServer();
        const localPort = await port;

        const loginUrl = new URL('/cli-auth', dashboardUrlFor(config.apiUrl));
        loginUrl.searchParams.set('port', String(localPort));
        loginUrl.searchParams.set('state', state);

        printSuccess(`Waiting for browser authentication…`);
        process.stdout.write(`\nIf your browser doesn't open automatically, visit:\n${chalk.cyan(loginUrl.toString())}\n\n`);

        if (options.open) {
          await open(loginUrl.toString()).catch(() => {
            // Non-fatal — the printed URL above is always the fallback.
          });
        }

        let outcome;
        try {
          outcome = await result;
        } catch (error) {
          throw error instanceof CliError ? error : new CliError('auth', 'Browser login failed.', { cause: error });
        }

        await writeCredentials({
          token: outcome.token,
          email: outcome.email,
          apiUrl: config.apiUrl,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`Logged in as ${outcome.email}`);
      }),
    );
}

/**
 * The dashboard's own origin, derived from the Control API's URL — in
 * local dev the API is on :4100 and the dashboard on :3000; in a real
 * deployment RAVEN_DASHBOARD_URL should be set explicitly since the two
 * need not share a host at all. See docs/cli.md#authentication.
 */
function dashboardUrlFor(apiUrl: string): string {
  if (process.env.RAVEN_DASHBOARD_URL) return process.env.RAVEN_DASHBOARD_URL;
  try {
    const url = new URL(apiUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return `${url.protocol}//${url.hostname}:3000`;
    }
  } catch {
    // fall through to the generic default below
  }
  return apiUrl;
}
