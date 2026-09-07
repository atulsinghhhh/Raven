import { createServer, Server } from 'node:http';
import { createSocket, Socket } from 'node:dgram';
import { AddressInfo } from 'node:net';
import { checkSfuHttp, checkStunBinding } from './dependency-checks.util';

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
    // /healthz, deliberately: readiness on a node reports whether it can
    // accept new participants, which depends on its control-plane link —
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
      // already closed — fine, nothing left to clean up
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
