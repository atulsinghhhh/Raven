import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAuthorized } from './auth.js';
import { config } from './config.js';
import { EgressManager } from './egress-manager.js';
import { startHarnessServer } from './harness-server.js';
import { AzureBlobStorageDriver } from './storage/azure-blob-storage-driver.js';

const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'harness');

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body ? { 'content-type': 'application/json' } : undefined);
  res.end(body ? JSON.stringify(body) : undefined);
}

async function main(): Promise<void> {
  const storage = new AzureBlobStorageDriver({
    connectionString: config.azureStorageConnectionString,
    container: config.azureStorageContainer,
    publicBaseUrl: config.cdnBaseUrl,
  });
  await storage.ensureContainer();

  const { url: harnessBaseUrl } = await startHarnessServer(HARNESS_DIR);
  const manager = new EgressManager(storage, harnessBaseUrl);

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAuthorized(req)) return send(res, 401, { error: 'unauthorized' });

    try {
      if (req.method === 'POST' && req.url === '/internal/egress/start') {
        const body = await readJsonBody<{
          streamId: string;
          roomId: string;
          rtcToken: string;
          rtcEndpoint: string;
          iceServers?: unknown[];
        }>(req);
        // Acknowledge immediately, don't make the API's own call wait on a
        // full headless-browser launch + join + ffmpeg spawn (which can
        // easily exceed the API's own short request timeout) — heartbeats
        // are how the API learns whether this actually succeeded, same as
        // any real viewer's join is asynchronous from the API's own
        // credential-mint response.
        send(res, 204);
        manager.start(body).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`egress start failed for stream ${body.streamId}: ${(err as Error).message}`);
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/internal/egress/stop') {
        const body = await readJsonBody<{ streamId: string }>(req);
        await manager.stop(body.streamId);
        return send(res, 204);
      }

      return send(res, 404, { error: 'not found' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`egress-worker request failed: ${(err as Error).message}`);
      return send(res, 500, { error: 'internal error' });
    }
  }

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`egress-worker (${config.workerId}) listening on port ${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
