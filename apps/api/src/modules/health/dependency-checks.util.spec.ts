import { createServer, Server } from 'node:http';
import { createSocket, Socket } from 'node:dgram';
import { createHash, createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { checkSfuHttp, checkStunBinding, checkTurnAllocate } from './dependency-checks.util';

// --- a minimal fake coturn, from the server's side of the wire --------
//
// Mirrors the real client-side implementation's constants/framing so the
// test proves the actual STUN/TURN parsing and MESSAGE-INTEGRITY
// verification, not a stub of it.
const MAGIC = 0x2112a442;
const ALLOCATE = 0x0003;
const ALLOC_SUCCESS = 0x0103;
const ALLOC_ERROR = 0x0113;
const REFRESH = 0x0004;
const REFRESH_SUCCESS = 0x0104;
const A_USERNAME = 0x0006;
const A_ERROR_CODE = 0x0009;
const A_REALM = 0x0014;
const A_NONCE = 0x0015;
const A_XOR_RELAYED = 0x0016;

function pad(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}
function attr(type: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, pad(value)]);
}
function parseMessage(data: Buffer): { messageType: number; transactionId: Buffer; attrs: Map<number, Buffer> } {
  const messageType = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  const transactionId = data.subarray(8, 20);
  const attrs = new Map<number, Buffer>();
  let offset = 20;
  while (offset < 20 + length) {
    const t = data.readUInt16BE(offset);
    const l = data.readUInt16BE(offset + 2);
    attrs.set(t, data.subarray(offset + 4, offset + 4 + l));
    offset += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { messageType, transactionId, attrs };
}
function buildMessage(messageType: number, transactionId: Buffer, attrBufs: Buffer[]): Buffer {
  const body = Buffer.concat(attrBufs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(messageType, 0);
  header.writeUInt16BE(body.length, 2);
  header.writeUInt32BE(MAGIC, 4);
  transactionId.copy(header, 8);
  return Buffer.concat([header, body]);
}
function errorCodeAttr(code: number): Buffer {
  const buf = Buffer.alloc(4);
  buf[2] = Math.floor(code / 100);
  buf[3] = code % 100;
  return buf;
}
function xorRelayedAddress(ip: string, port: number): Buffer {
  const buf = Buffer.alloc(8);
  buf[1] = 0x01; // family: IPv4
  buf.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const octets = ip.split('.').map(Number);
  const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  buf.writeUInt32BE((ipInt ^ MAGIC) >>> 0, 4);
  return buf;
}

/** A fake coturn speaking just enough of the REST-auth Allocate handshake to drive checkTurnAllocate. */
function startFakeCoturn(opts: {
  secret: string;
  realm: string;
  relayIp: string;
  relayPort: number;
  rejectAuthenticated?: boolean;
}): Promise<{ socket: Socket; port: number; close: () => void }> {
  const sock = createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    const { messageType, transactionId, attrs } = parseMessage(msg);
    if (messageType === ALLOCATE && !attrs.has(A_USERNAME)) {
      // Step 1: unauthenticated — challenge with realm + nonce.
      const nonce = Buffer.from('test-nonce');
      const resp = buildMessage(ALLOC_ERROR, transactionId, [
        attr(A_ERROR_CODE, errorCodeAttr(401)),
        attr(A_REALM, Buffer.from(opts.realm)),
        attr(A_NONCE, nonce),
      ]);
      sock.send(resp, rinfo.port, rinfo.address);
      return;
    }
    if (messageType === ALLOCATE && attrs.has(A_USERNAME)) {
      if (opts.rejectAuthenticated) {
        const resp = buildMessage(ALLOC_ERROR, transactionId, [attr(A_ERROR_CODE, errorCodeAttr(401))]);
        sock.send(resp, rinfo.port, rinfo.address);
        return;
      }
      // Verify the credential the same way coturn would — recompute the
      // key from the shared secret and check MESSAGE-INTEGRITY over the
      // actual bytes received, not a reconstruction of them. This is
      // what makes the test prove the client's MAC computation is
      // correct, not just that the message shape parses: a real coturn
      // would reject a bad MAC exactly like this, and the test below
      // asserts on checkTurnAllocate's resulting verdict rather than
      // asserting inside this network callback.
      const username = attrs.get(A_USERNAME)!.toString('utf8');
      const credential = createHmac('sha1', opts.secret).update(username).digest('base64');
      const key = createHash('md5').update(`${username}:${opts.realm}:${credential}`).digest();
      const withoutIntegrity = msg.subarray(0, msg.length - 24);
      const receivedMac = msg.subarray(msg.length - 20);
      const expectedMac = createHmac('sha1', key).update(withoutIntegrity).digest();

      if (!receivedMac.equals(expectedMac)) {
        const resp = buildMessage(ALLOC_ERROR, transactionId, [attr(A_ERROR_CODE, errorCodeAttr(401))]);
        sock.send(resp, rinfo.port, rinfo.address);
        return;
      }

      const resp = buildMessage(ALLOC_SUCCESS, transactionId, [
        attr(A_XOR_RELAYED, xorRelayedAddress(opts.relayIp, opts.relayPort)),
      ]);
      sock.send(resp, rinfo.port, rinfo.address);
      return;
    }
    if (messageType === REFRESH) {
      const resp = buildMessage(REFRESH_SUCCESS, transactionId, []);
      sock.send(resp, rinfo.port, rinfo.address);
    }
  });
  return new Promise((resolve) => {
    sock.bind(0, () => {
      resolve({ socket: sock, port: (sock.address() as AddressInfo).port, close: () => sock.close() });
    });
  });
}

describe('checkSfuHttp', () => {
  let server: Server;
  let port: number;

  afterEach(() => {
    server?.close();
  });

  it('resolves true when the node answers 2xx', async () => {
    server = createServer((_req, res) => res.writeHead(200).end('ok'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;

    await expect(checkSfuHttp(`http://localhost:${port}`)).resolves.toBe(true);
  });

  it('probes /healthz, not the root or /readyz', async () => {
    // /healthz, by design: readiness on a node reports whether it can
    // accept new participants, which depends on its control-plane link;
    // asking that from the control plane would make the answer partly
    // about the question.
    const paths: string[] = [];
    server = createServer((req, res) => {
      paths.push(req.url ?? '');
      res.writeHead(200).end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;

    await checkSfuHttp(`http://localhost:${port}`);
    expect(paths).toEqual(['/healthz']);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const paths: string[] = [];
    server = createServer((req, res) => {
      paths.push(req.url ?? '');
      res.writeHead(200).end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;

    await checkSfuHttp(`http://localhost:${port}/`);
    expect(paths).toEqual(['/healthz']);
  });

  it('resolves false when the node answers non-2xx', async () => {
    server = createServer((_req, res) => res.writeHead(503).end('nope'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;

    await expect(checkSfuHttp(`http://localhost:${port}`)).resolves.toBe(false);
  });

  it('resolves false (not throw) when nothing is listening at all', async () => {
    await expect(checkSfuHttp('http://localhost:1')).resolves.toBe(false);
  });
});

describe('checkStunBinding', () => {
  let socket: Socket | undefined;

  afterEach(() => {
    try {
      socket?.close();
    } catch {
      // already closed: fine, nothing left to clean up
    }
    socket = undefined;
  });

  it('resolves true against a server that replies with a well-formed STUN response', async () => {
    const sock = createSocket('udp4');
    socket = sock;
    sock.on('message', (msg, rinfo) => {
      // Echo a minimal valid STUN success response, reusing the request's
      // magic cookie + transaction ID like coturn would.
      const response = Buffer.alloc(20);
      response.writeUInt16BE(0x0101, 0); // Binding Success Response
      response.writeUInt16BE(0, 2);
      msg.copy(response, 4, 4, 20); // copy magic cookie + transaction ID verbatim
      sock.send(response, rinfo.port, rinfo.address);
    });
    const port = await new Promise<number>((resolve) => {
      sock.bind(0, () => resolve((sock.address() as AddressInfo).port));
    });

    await expect(checkStunBinding('127.0.0.1', port, 1000)).resolves.toBe(true);
  });

  it('resolves false when the transaction ID does not match (spoofed/stale response)', async () => {
    const sock = createSocket('udp4');
    socket = sock;
    sock.on('message', (_msg, rinfo) => {
      const response = Buffer.alloc(20);
      response.writeUInt16BE(0x0101, 0);
      response.writeUInt16BE(0, 2);
      response.writeUInt32BE(0x2112a442, 4);
      // transaction ID left as zeros so it won't match the request
      sock.send(response, rinfo.port, rinfo.address);
    });
    const port = await new Promise<number>((resolve) => {
      sock.bind(0, () => resolve((sock.address() as AddressInfo).port));
    });

    await expect(checkStunBinding('127.0.0.1', port, 500)).resolves.toBe(false);
  });

  it('resolves false (not hang forever) when nothing responds at all', async () => {
    await expect(checkStunBinding('127.0.0.1', 1, 300)).resolves.toBe(false);
  });
});

describe('checkTurnAllocate', () => {
  let fake: { socket: Socket; port: number; close: () => void } | undefined;

  afterEach(() => {
    fake?.close();
    fake = undefined;
  });

  it('succeeds against a fake coturn that authenticates the exact credential RtcTokensService mints, and reports the public relay address', async () => {
    fake = await startFakeCoturn({ secret: 'shared-secret', realm: 'test.local', relayIp: '203.0.113.10', relayPort: 51234 });

    const result = await checkTurnAllocate('127.0.0.1', fake.port, 'shared-secret', 2000);

    expect(result.ok).toBe(true);
    expect(result.isPrivateRelay).toBe(false);
    expect(result.relayedAddress).toEqual({ ip: '203.0.113.10', port: 51234 });
  });

  it('flags a private relay address — the exact SFU_PUBLIC_IP-class misconfiguration (external-ip unset) this check exists to catch', async () => {
    fake = await startFakeCoturn({ secret: 'shared-secret', realm: 'test.local', relayIp: '10.10.1.5', relayPort: 51234 });

    const result = await checkTurnAllocate('127.0.0.1', fake.port, 'shared-secret', 2000);

    expect(result.ok).toBe(true);
    expect(result.isPrivateRelay).toBe(true);
  });

  it('fails when the shared secret does not match — proves the MAC is actually checked, not just message shape', async () => {
    fake = await startFakeCoturn({ secret: 'the-real-secret', realm: 'test.local', relayIp: '203.0.113.10', relayPort: 51234 });

    const result = await checkTurnAllocate('127.0.0.1', fake.port, 'a-different-secret', 2000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('fails when coturn rejects the authenticated Allocate outright (forged-credential class failure)', async () => {
    fake = await startFakeCoturn({
      secret: 'shared-secret',
      realm: 'test.local',
      relayIp: '203.0.113.10',
      relayPort: 51234,
      rejectAuthenticated: true,
    });

    const result = await checkTurnAllocate('127.0.0.1', fake.port, 'shared-secret', 2000);

    expect(result.ok).toBe(false);
  });

  it('resolves false (not hang forever) when nothing responds at all', async () => {
    const result = await checkTurnAllocate('127.0.0.1', 1, 'shared-secret', 300);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no response');
  });
});
