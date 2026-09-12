import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? '8600', 10),
  sharedSecret: requireEnv('EGRESS_WORKER_SHARED_SECRET'),
  workerId: process.env.WORKER_ID ?? `${hostname()}-${randomUUID().slice(0, 8)}`,

  // Where this worker calls back to report heartbeats — apps/api's
  // internal endpoint, guarded by EgressWorkerGuard with the same secret.
  apiHeartbeatUrl: requireEnv('API_HEARTBEAT_URL'),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '5000', 10),

  // Azure Blob Storage — the only storage backend this pass implements
  // (see AzureBlobStorageDriver's own doc comment for why).
  azureStorageConnectionString: requireEnv('AZURE_STORAGE_CONNECTION_STRING'),
  azureStorageContainer: process.env.AZURE_STORAGE_CONTAINER ?? 'live-hls',
  // The Azure Front Door/CDN endpoint in front of that container — never
  // the storage account's own URL, and never exposes credentials.
  cdnBaseUrl: requireEnv('CDN_BASE_URL'),

  hlsSegmentSeconds: parseInt(process.env.HLS_SEGMENT_SECONDS ?? '6', 10),
  hlsListSize: parseInt(process.env.HLS_LIST_SIZE ?? '10', 10),

  workDir: process.env.EGRESS_WORK_DIR ?? '/tmp/egress-worker',
};
