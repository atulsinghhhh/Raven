import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';

/**
 * Probes one RTC server's liveness endpoint.
 *
 * `/healthz`, not `/readyz`: readiness on a node reports whether it can
 * accept *new* participants, which depends on its control-plane link.
 * Asking that from the control plane would make the answer partly about
 * the question: what this check wants to know is whether the node
 * process is alive and reachable from here.
 */
export async function checkSfuHttp(internalUrl: string, timeoutMs = 2000): Promise<boolean> {
  const base = internalUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/healthz`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_BINDING_REQUEST = 0x0001;

/**
 * A real STUN Binding Request/Response over UDP (RFC 5389), not a fake
 * ping. We do this instead of shelling out to a CLI tool so the API
 * process reaches coturn directly over the network, same as a real client.
 */
export function checkStunBinding(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const transactionId = randomBytes(12);

    const request = Buffer.alloc(20);
    request.writeUInt16BE(STUN_BINDING_REQUEST, 0);
    request.writeUInt16BE(0, 2); // message length: no attributes
    request.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
    transactionId.copy(request, 8);

    const finish = (result: boolean) => {
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.once('error', () => finish(false));

    socket.once('message', (msg) => {
      const validResponse =
        msg.length >= 20 &&
        (msg.readUInt16BE(0) & 0x0110) !== 0 && // response class: success or error
        msg.readUInt32BE(4) === STUN_MAGIC_COOKIE &&
        msg.subarray(8, 20).equals(transactionId);
      finish(validResponse);
    });

    socket.send(request, port, host, (error) => {
      if (error) finish(false);
    });
  });
}
