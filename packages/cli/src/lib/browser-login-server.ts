import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { CliError } from './errors.js';

export interface BrowserLoginResult {
  token: string;
  email: string;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to complete the browser step

/**
 * Starts a one-shot local HTTP server bound to 127.0.0.1 only (never
 * 0.0.0.0 — this must not be reachable from the network) that waits for
 * the dashboard's /cli-auth bridge page to relay the user's *existing*
 * session token here, after they approve the CLI login in their browser.
 * See docs/cli.md#authentication for the full flow and
 * apps/dashboard/src/app/cli-auth for the browser side.
 *
 * This reuses the Control API's existing JWT session auth verbatim — it
 * is not a second authentication system. The local server's only job is
 * to receive that token over localhost and hand it back to the CLI
 * process that's waiting for it.
 */
export function startBrowserLoginServer(): {
  port: Promise<number>;
  state: string;
  result: Promise<BrowserLoginResult>;
} {
  const state = randomBytes(16).toString('hex');
  let server: Server;

  const portPromise = new Promise<number>((resolvePort, rejectPort) => {
    server = createServer();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolvePort(address.port);
      else rejectPort(new Error('Could not determine local server port'));
    });
  });

  const result = new Promise<BrowserLoginResult>((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      server?.close();
      rejectResult(
        new CliError('auth', 'Timed out waiting for browser login.', {
          suggestion: 'Run `raven login` again',
        }),
      );
    }, LOGIN_TIMEOUT_MS);

    portPromise.then(() => {
      server.on('request', (req, res) => {
        // CORS: the dashboard origin (which may be a real remote host, not
        // localhost) needs to be allowed to POST here from the browser —
        // this server is single-use, ephemeral, and closes immediately
        // after the one exchange it exists for.
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }

        if (req.method !== 'POST' || req.url !== '/callback') {
          res.writeHead(404).end();
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { state?: string; token?: string; email?: string };
            if (parsed.state !== state || !parsed.token || !parsed.email) {
              res.writeHead(400, { 'Content-Type': 'application/json' }).end(
                JSON.stringify({ message: 'Invalid callback payload' }),
              );
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
            clearTimeout(timeout);
            server.close();
            resolveResult({ token: parsed.token, email: parsed.email });
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(
              JSON.stringify({ message: 'Malformed request body' }),
            );
          }
        });
      });
    });
  });

  return { port: portPromise, state, result };
}
