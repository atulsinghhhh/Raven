import { createSocket } from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { generateTurnCredential } from '../rtc-tokens/turn-credential.util';

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

// --- TURN Allocate over the long-term credential mechanism (RFC 5766) -----
//
// Ports infrastructure/azure/tests/turn_allocate.py to TypeScript for the
// continuous health checker (10k-scaling audit Phase 4) — that script is
// the deploy-time proof this scheme works at all; this is the same two-
// step exchange, run on an interval instead of once. Kept close to the
// Python line-for-line rather than reinvented, since a subtly-wrong STUN/
// TURN implementation is a worse outcome than not having one.
//
// STUN binding alone (checkStunBinding above) cannot catch coturn's
// documented fail-open failure mode: a config file it couldn't read
// leaves it running with no realm and no authentication, an open relay
// that still answers STUN perfectly. Only an actual authenticated
// Allocate — the thing 07-deploy-coturn.sh's own assertion checks for at
// deploy time — proves auth is actually enforced.
const TURN_MAGIC_COOKIE = 0x2112a442;
const TURN_ALLOCATE = 0x0003;
const TURN_ALLOCATE_SUCCESS = 0x0103;
const TURN_ALLOCATE_ERROR = 0x0113;
const TURN_ATTR_USERNAME = 0x0006;
const TURN_ATTR_MESSAGE_INTEGRITY = 0x0008;
const TURN_ATTR_ERROR_CODE = 0x0009;
const TURN_ATTR_REALM = 0x0014;
const TURN_ATTR_NONCE = 0x0015;
const TURN_ATTR_XOR_RELAYED_ADDRESS = 0x0016;
const TURN_ATTR_REQUESTED_TRANSPORT = 0x0019;
const TURN_ATTR_LIFETIME = 0x000d;
const TURN_REFRESH = 0x0004;
const TURN_TRANSPORT_UDP = 17; // IANA protocol number, per RFC 5766 §14.7

function turnPad(value: Buffer): Buffer {
  const remainder = value.length % 4;
  return remainder === 0 ? value : Buffer.concat([value, Buffer.alloc(4 - remainder)]);
}

function turnAttr(type: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, turnPad(value)]);
}

function parseTurnMessage(data: Buffer): { messageType: number; attrs: Map<number, Buffer> } {
  const messageType = data.readUInt16BE(0);
  const messageLength = data.readUInt16BE(2);
  const attrs = new Map<number, Buffer>();
  let offset = 20;
  while (offset < 20 + messageLength && offset + 4 <= data.length) {
    const attrType = data.readUInt16BE(offset);
    const attrLength = data.readUInt16BE(offset + 2);
    attrs.set(attrType, data.subarray(offset + 4, offset + 4 + attrLength));
    offset += 4 + attrLength + ((4 - (attrLength % 4)) % 4);
  }
  return { messageType, attrs };
}

function buildTurnRequest(method: number, transactionId: Buffer, attrBufs: Buffer[], integrityKey?: Buffer): Buffer {
  const body = Buffer.concat(attrBufs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(method, 0);
  header.writeUInt16BE(integrityKey ? body.length + 24 : body.length, 2);
  header.writeUInt32BE(TURN_MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);

  if (!integrityKey) {
    return Buffer.concat([header, body]);
  }
  // MESSAGE-INTEGRITY covers the header + body with the length field
  // already counting the 24-byte integrity attribute itself — the
  // attribute has to be sized in before it can be computed.
  const mac = createHmac('sha1', integrityKey).update(Buffer.concat([header, body])).digest();
  return Buffer.concat([header, body, turnAttr(TURN_ATTR_MESSAGE_INTEGRITY, mac)]);
}

function sendAndReceive(socket: ReturnType<typeof createSocket>, request: Buffer, host: string, port: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a response')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.send(request, port, host, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

export interface TurnAllocateResult {
  ok: boolean;
  /** Populated only when ok is true and the response carried one. */
  relayedAddress?: { ip: string; port: number };
  /** True when the relay address is a private/RFC1918 IP — SFU_PUBLIC_IP-class misconfiguration (external-ip unset). */
  isPrivateRelay?: boolean;
  /** Human-readable reason, populated only when ok is false. */
  error?: string;
}

/**
 * Runs the exact two-step exchange 07-deploy-coturn.sh's own deploy-time
 * assertion runs, using a credential minted the same way
 * RtcTokensService mints one for a real client. A pass here means "this
 * host authenticates Livqeno's tokens and hands back a real relay
 * address" — the actual thing a client depends on, not a proxy for it.
 */
export async function checkTurnAllocate(
  host: string,
  port: number,
  secret: string,
  timeoutMs = 4000,
): Promise<TurnAllocateResult> {
  const socket = createSocket('udp4');
  try {
    // Step 1: unauthenticated Allocate. A healthy, auth-enforcing coturn
    // refuses this with 401 + REALM + NONCE — it never succeeds outright.
    const step1TxId = randomBytes(12);
    const step1Request = buildTurnRequest(TURN_ALLOCATE, step1TxId, [
      turnAttr(TURN_ATTR_REQUESTED_TRANSPORT, Buffer.from([TURN_TRANSPORT_UDP, 0, 0, 0])),
    ]);

    let response: Buffer;
    try {
      response = await sendAndReceive(socket, step1Request, host, port, timeoutMs);
    } catch (err) {
      return { ok: false, error: `no response to unauthenticated Allocate: ${(err as Error).message}` };
    }

    const step1 = parseTurnMessage(response);
    if (step1.messageType !== TURN_ALLOCATE_ERROR) {
      return { ok: false, error: `expected a 401 error response, got message type 0x${step1.messageType.toString(16)}` };
    }
    const errorAttr = step1.attrs.get(TURN_ATTR_ERROR_CODE);
    const errorCode = errorAttr ? errorAttr[2] * 100 + errorAttr[3] : 0;
    if (errorCode !== 401) {
      return { ok: false, error: `expected error code 401, got ${errorCode}` };
    }
    const realm = step1.attrs.get(TURN_ATTR_REALM)?.toString('utf8') ?? '';
    const nonce = step1.attrs.get(TURN_ATTR_NONCE) ?? Buffer.alloc(0);

    // Step 2: authenticated Allocate with a credential minted the same
    // way a real client's token mint does.
    const { username, credential } = generateTurnCredential(secret, 60, 'turn-health-check');
    const key = createHash('md5').update(`${username}:${realm}:${credential}`).digest();
    const step2TxId = randomBytes(12);
    const step2Request = buildTurnRequest(
      TURN_ALLOCATE,
      step2TxId,
      [
        turnAttr(TURN_ATTR_REQUESTED_TRANSPORT, Buffer.from([TURN_TRANSPORT_UDP, 0, 0, 0])),
        turnAttr(TURN_ATTR_USERNAME, Buffer.from(username, 'utf8')),
        turnAttr(TURN_ATTR_REALM, Buffer.from(realm, 'utf8')),
        turnAttr(TURN_ATTR_NONCE, nonce),
      ],
      key,
    );

    let response2: Buffer;
    try {
      response2 = await sendAndReceive(socket, step2Request, host, port, timeoutMs);
    } catch (err) {
      return { ok: false, error: `no response to authenticated Allocate: ${(err as Error).message}` };
    }

    const step2 = parseTurnMessage(response2);
    if (step2.messageType !== TURN_ALLOCATE_SUCCESS) {
      const err = step2.attrs.get(TURN_ATTR_ERROR_CODE);
      const code = err ? err[2] * 100 + err[3] : 0;
      const reason = err ? err.subarray(4).toString('utf8') : '';
      return { ok: false, error: `authenticated Allocate rejected: ${code} ${reason}`.trim() };
    }

    // The allocation just succeeded, which means coturn now holds one real
    // relay port open against this check, same as it would for a real
    // client. Release it immediately rather than letting it sit for its
    // default lifetime (coturn's default is 600s) — this check runs on an
    // interval from every API instance, and a coturn deployment's relay
    // port range can be small (this repo's own production template is 41
    // ports); leaving allocations to expire naturally would let the
    // health check itself exhaust the thing it's checking. Best-effort:
    // a failed Refresh doesn't change the health verdict, since the
    // allocation is still going to expire on its own either way.
    const refreshTxId = randomBytes(12);
    const refreshRequest = buildTurnRequest(
      TURN_REFRESH,
      refreshTxId,
      [
        turnAttr(TURN_ATTR_LIFETIME, Buffer.from([0, 0, 0, 0])),
        turnAttr(TURN_ATTR_USERNAME, Buffer.from(username, 'utf8')),
        turnAttr(TURN_ATTR_REALM, Buffer.from(realm, 'utf8')),
        turnAttr(TURN_ATTR_NONCE, nonce),
      ],
      key,
    );
    // This function's contract is the health verdict, not perfect relay-
    // port hygiene — a failed Refresh is not itself a health failure.
    await sendAndReceive(socket, refreshRequest, host, port, timeoutMs).catch(() => Buffer.alloc(0));

    const relayed = step2.attrs.get(TURN_ATTR_XOR_RELAYED_ADDRESS);
    if (!relayed || relayed.length < 8) {
      // Allocated fine, just didn't carry the attribute this check reads.
      return { ok: true };
    }
    const relayedPort = relayed.readUInt16BE(2) ^ (TURN_MAGIC_COOKIE >>> 16);
    const relayedIpInt = relayed.readUInt32BE(4) ^ TURN_MAGIC_COOKIE;
    const ip = [24, 16, 8, 0].map((shift) => (relayedIpInt >>> shift) & 0xff).join('.');
    const isPrivateRelay = ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.');

    return { ok: true, relayedAddress: { ip, port: relayedPort }, isPrivateRelay };
  } finally {
    socket.close();
  }
}
