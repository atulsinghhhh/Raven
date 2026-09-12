import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config.js';

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Authenticates a request from apps/api — same shared-bearer-secret shape as EgressWorkerGuard's own check on the reverse direction (the worker's heartbeat call into the API). */
export function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  return !!provided && constantTimeEquals(provided, config.sharedSecret);
}
