import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';

/** LiveKit serves HTTP on the same host/port its ws(s):// URL points at. */
export async function checkLiveKitHttp(livekitUrl: string, timeoutMs = 2000): Promise<boolean> {
  const httpUrl = livekitUrl.replace(/^ws/, 'http');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(httpUrl, { signal: controller.signal });
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
 * A real STUN Binding Request/Response (RFC 5389) over UDP — not a
 * fake/simulated "ping". Used instead of shelling out to a CLI tool
 * (scripts/verify-infra.sh's approach, which needs docker exec) since the
 * API process should reach coturn directly over the network, the same way
 * a real client would.
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
        (msg.readUInt16BE(0) & 0x0110) !== 0 && // STUN response class (success or error)
        msg.readUInt32BE(4) === STUN_MAGIC_COOKIE &&
        msg.subarray(8, 20).equals(transactionId);
      finish(validResponse);
    });

    socket.send(request, port, host, (error) => {
      if (error) finish(false);
    });
  });
}
