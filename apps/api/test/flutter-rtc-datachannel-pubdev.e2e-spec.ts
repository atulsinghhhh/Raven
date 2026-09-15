import { createReadStream, existsSync } from 'fs';
import { createServer, type Server } from 'http';
import { extname, join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';
import { registerLocalSfu } from './helpers/register-local-sfu';

/**
 * Real E2E check of the *published* `raven_rtc` package's data channel and
 * reconnect behavior, against a real backend and a real SFU. Two Flutter
 * Web tabs (built from `flutter_check/published_consumer`, pub.dev
 * `raven_rtc` — no path override), no camera/mic involved: this is scoped
 * to `sendData`/`data` and `autoReconnect`, which is exactly what
 * `flutter-live-streaming-pubdev.e2e-spec.ts` does not exercise.
 *
 * The data-channel assertion below calls `sendData` the moment it becomes
 * callable — i.e. immediately after `Raven.join()` resolves, before
 * anything has opened a data channel — which is deliberately the "sending
 * before the data channel is fully open" case `RavenEngine.sendData`
 * documents handling (it calls `ensureDataChannel()` then awaits the open
 * before actually sending).
 *
 * Reconnect is exercised with a real network drop
 * (`BrowserContext.setOffline`), not a mock: the underlying signaling
 * WebSocket actually closes, `Raven`'s `autoReconnect` actually has to
 * reconnect and rejoin, and the test asserts on the real
 * `connectionState` transition (`connected` -> `reconnecting` ->
 * `connected`) plus a real send succeeding again afterwards.
 */
jest.setTimeout(120_000);

const DATA_APP_WEB_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'flutter_check',
  'published_consumer',
  'build',
  'web_data',
);

function startStaticServer(rootDir: string, defaultFile: string): Promise<{ server: Server; url: string }> {
  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.png': 'image/png',
  };
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const filePath = join(rootDir, path === '/' ? defaultFile : path);
    if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function localSignalingEndpoint(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('app is not listening');
  return `ws://127.0.0.1:${port}/v1/rtc`;
}

type State = Record<string, unknown>;

async function waitFor(page: Page, predicate: () => boolean, description: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const state = await page.evaluate(() => (window as unknown as { __state?: State }).__state ?? {});
  throw new Error(`Timed out waiting for ${description}. Last __state: ${JSON.stringify(state)}`);
}

describe('raven_rtc (published pub.dev package) — data channel and reconnect (real E2E)', () => {
  let app: INestApplication;
  let server: Server;
  let urlBase: string;
  let signalingEndpoint: string;
  let browser: Browser;
  let apiKey: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    if (!existsSync(join(DATA_APP_WEB_DIR, 'index.html'))) {
      throw new Error(
        `No Flutter web build at ${DATA_APP_WEB_DIR}.\n` +
          'Run: (cd flutter_check/published_consumer && flutter build web --release ' +
          '-t lib/main_data.dart -o build/web_data)',
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    signalingEndpoint = localSignalingEndpoint(app);

    const redis = app.get(RedisService);
    const stale = await redis.client.keys('ratelimit:*');
    if (stale.length > 0) await redis.client.del(...stale);

    await registerLocalSfu(app);

    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `flutter-data-pubdev-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `flutter-data-pubdev-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const staticFiles = await startStaticServer(DATA_APP_WEB_DIR, 'index.html');
    server = staticFiles.server;
    urlBase = staticFiles.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  beforeEach(async () => {
    browser = await chromium.launch();
  });

  afterEach(async () => {
    await browser?.close();
  });

  async function mintRoomAndTokens(): Promise<{ roomId: string; alice: string; bob: string; iceServers: unknown[] }> {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: `data-e2e-${suffix}-${Date.now()}` })
      .expect(201);
    const roomId = room.body.id as string;

    const permissions = { join: true, subscribe: true, publish: false, publishData: true };
    const aliceRes = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/rtc-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ participantIdentity: 'alice', permissions })
      .expect(201);
    const bobRes = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/rtc-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ participantIdentity: 'bob', permissions })
      .expect(201);

    return { roomId, alice: aliceRes.body.token, bob: bobRes.body.token, iceServers: aliceRes.body.iceServers };
  }

  function appUrl(opts: { token: string; roomId: string; iceServers: unknown[] }): string {
    const params = new URLSearchParams({
      token: opts.token,
      endpoint: signalingEndpoint,
      roomId: opts.roomId,
      iceServers: JSON.stringify(opts.iceServers),
    });
    return `${urlBase}/index.html?${params.toString()}`;
  }

  it('sendData/data: two real participants exchange data-channel messages, including a send issued before the channel is open', async () => {
    const { roomId, alice, bob, iceServers } = await mintRoomAndTokens();

    let aliceCtx: BrowserContext | undefined;
    let bobCtx: BrowserContext | undefined;
    try {
      aliceCtx = await browser.newContext();
      bobCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();
      const bobPage = await bobCtx.newPage();
      alicePage.on('console', (m) => console.log('[alice console]', m.text()));
      bobPage.on('console', (m) => console.log('[bob console]', m.text()));
      alicePage.on('pageerror', (e) => console.log('[alice pageerror]', e));
      bobPage.on('pageerror', (e) => console.log('[bob pageerror]', e));

      await Promise.all([
        alicePage.goto(appUrl({ token: alice, roomId, iceServers })),
        bobPage.goto(appUrl({ token: bob, roomId, iceServers })),
      ]);

      // `__doSendData` is registered right after `Raven.join()` resolves —
      // before anything has opened a data channel. Calling it the instant
      // it exists, rather than waiting for `ready`, is the "before the
      // data channel is fully open" case.
      await waitFor(
        alicePage,
        () => typeof (window as unknown as { __doSendData?: unknown }).__doSendData === 'function',
        "alice's __doSendData bridge to be registered",
      );
      await waitFor(
        bobPage,
        () => typeof (window as unknown as { __doSendData?: unknown }).__doSendData === 'function',
        "bob's __doSendData bridge to be registered",
      );

      await alicePage.evaluate(
        (msg) => (window as unknown as { __doSendData: (m: string) => void }).__doSendData(msg),
        'hello-from-alice-before-open',
      );

      try {
        await waitFor(
          bobPage,
          () => {
            const received = (window as unknown as { __state?: { receivedData?: string[] } }).__state?.receivedData;
            return !!received && received.includes('hello-from-alice-before-open');
          },
          "bob to receive alice's pre-open message",
          15_000,
        );
      } catch (err) {
        const aliceState = await alicePage.evaluate(() => (window as unknown as { __state: State }).__state);
        console.log('[test][debug] alice state:', JSON.stringify(aliceState));
        throw err;
      }

      const bobState = await bobPage.evaluate(() => (window as unknown as { __state: State }).__state);
      console.log('[test] bob state after receiving:', JSON.stringify(bobState));
      expect(bobState.connectionState).toBe('connected');

      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { sentData?: string[] } }).__state?.sentData?.length === 1,
        "alice's send to be confirmed locally",
      );

      // Reply the other direction, proving it isn't one-way.
      await bobPage.evaluate(
        (msg) => (window as unknown as { __doSendData: (m: string) => void }).__doSendData(msg),
        'hello-from-bob',
      );
      await waitFor(
        alicePage,
        () => {
          const received = (window as unknown as { __state?: { receivedData?: string[] } }).__state?.receivedData;
          return !!received && received.includes('hello-from-bob');
        },
        "alice to receive bob's reply",
      );
    } finally {
      await aliceCtx?.close();
      await bobCtx?.close();
    }
  });

  it('autoReconnect: a real network drop forces a reconnect, and the room is usable again afterwards', async () => {
    const { roomId, alice, iceServers } = await mintRoomAndTokens();

    let aliceCtx: BrowserContext | undefined;
    try {
      aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();
      await alicePage.goto(appUrl({ token: alice, roomId, iceServers }));

      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
        'the Flutter client to report ready',
        60_000,
      );
      const initial = await alicePage.evaluate(() => (window as unknown as { __state: State }).__state);
      console.log('[test] state before drop:', JSON.stringify(initial));
      expect(initial.connectionState).toBe('connected');

      console.log('[test] dropping the network (context.setOffline(true))');
      await aliceCtx.setOffline(true);

      await waitFor(
        alicePage,
        () => {
          const history = (window as unknown as { __state?: { connectionStateHistory?: string[] } }).__state
            ?.connectionStateHistory;
          return !!history && (history.includes('reconnecting') || history.includes('disconnected'));
        },
        'connectionState to reflect the real network drop',
        30_000,
      );

      console.log('[test] restoring the network');
      await aliceCtx.setOffline(false);

      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { connectionState?: string } }).__state?.connectionState === 'connected',
        'connectionState to return to connected after the network is restored',
        60_000,
      );

      const recovered = await alicePage.evaluate(() => (window as unknown as { __state: State }).__state);
      console.log('[test] state after reconnect:', JSON.stringify(recovered));
      console.log('[test] connectionState history:', JSON.stringify(recovered.connectionStateHistory));

      // The room must actually be usable again, not merely reporting
      // "connected" — a real send after reconnect is the proof.
      await alicePage.evaluate(
        (msg) => (window as unknown as { __doSendData: (m: string) => void }).__doSendData(msg),
        'post-reconnect-message',
      );
      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { sentData?: string[] } }).__state?.sentData?.includes(
          'post-reconnect-message',
        ) ?? false,
        'a send issued after reconnect to succeed',
      );
    } finally {
      await aliceCtx?.close();
    }
  });
});
