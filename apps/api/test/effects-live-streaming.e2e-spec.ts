import { createReadStream, existsSync } from 'fs';
import { createServer, type Server } from 'http';
import { extname, join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';
import { registerLocalSfu } from './helpers/register-local-sfu';
import { collectPageDiagnostics, waitForPage } from './helpers/page-diagnostics';

/**
 * Real-browser end-to-end test of Phase 16 (Livqeno Effects) on Live
 * Streaming. Reuses the exact same `e2e-harness/rtc-effects.html` page as
 * `effects-rtc.e2e-spec.ts`, on purpose: a live stream's host camera is
 * an ordinary `@ravenkash/rtc` `Room` underneath (`stream.room` in
 * `@ravenkash/client`'s `LiveStream`), so nothing Live-Streaming-specific
 * needs to exist in the harness for effects to work. What differs here is
 * only how credentials are minted: through the real `/v1/live-streams`
 * host/viewer endpoints instead of `/v1/rooms/:id/rtc-tokens`, and that
 * the stream lifecycle (create → start → end) is exercised for real
 * alongside it.
 *
 * The viewer-reception test was `.skip`ped for what turned out to be a
 * real bug, not an environment quirk: see
 * `effects-rtc.e2e-spec.ts`'s module doc for the diagnosis. Both run now.
 */
jest.setTimeout(120_000);

const HARNESS_DIR = join(__dirname, 'e2e-harness');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json' };

function startHarnessServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const filePath = join(HARNESS_DIR, path === '/' ? 'rtc-effects.html' : path);
    if (!filePath.startsWith(HARNESS_DIR) || !existsSync(filePath)) {
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

interface RtcCredentials {
  token: string;
  endpoint: string;
  iceServers: unknown[];
  roomName: string;
}

/**
 * Points the browser at *this* suite's app rather than at whatever
 * `API_PUBLIC_URL` names.
 *
 * The mint response's `endpoint` is derived from `API_PUBLIC_URL`, which
 * on a developer's machine is the compose API on :4100: a different
 * process reading a different database. A browser sent there would try to
 * join a stream whose room only exists in this suite's database and be
 * told `NO_RTC_CAPACITY`. Under LiveKit this never came up: every suite
 * shared one database, so "some Livqeno API" was good enough. It is not
 * good enough now that the e2e suite runs against a scratch database of
 * its own.
 */
function localSignalingEndpoint(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) {
    throw new Error('app is not listening — call app.listen(0) before minting credentials');
  }
  return `ws://127.0.0.1:${port}/v1/rtc`;
}

function harnessUrl(
  baseUrl: string,
  opts: { role: 'publisher' | 'subscriber'; creds: RtcCredentials; endpoint: string; preset?: string },
): string {
  const params = new URLSearchParams({
    roomId: opts.creds.roomName,
    role: opts.role,
    token: opts.creds.token,
    endpoint: opts.endpoint,
    iceServers: JSON.stringify(opts.creds.iceServers),
  });
  if (opts.preset) params.set('preset', opts.preset);
  return `${baseUrl}/rtc-effects.html?${params.toString()}`;
}

describe('Livqeno Effects — Live Streaming (real browser e2e)', () => {
  let app: INestApplication;
  let harnessServer: Server;
  let harnessUrlBase: string;
  let signalingEndpoint: string;
  let browser: Browser;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // A real listening socket, not just `getHttpServer()`: supertest can
    // drive an un-listened app, but a browser cannot.
    await app.listen(0);
    signalingEndpoint = localSignalingEndpoint(app);

    const redis = app.get(RedisService);
    const stale = await redis.client.keys('ratelimit:*');
    if (stale.length > 0) await redis.client.del(...stale);

    // See effects-rtc.e2e-spec.ts: the browser's join needs a registered
    // node in *this* suite's database, not the compose one's.
    await registerLocalSfu(app);

    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `effects-live-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `effects-live-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const harness = await startHarnessServer();
    harnessServer = harness.server;
    harnessUrlBase = harness.url;

    browser = await chromium.launch({
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => harnessServer.close(() => resolve()));
    await app.close();
  });

  async function createStream(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: `Effects E2E Stream ${suffix}`, hostIdentity: 'alice' })
      .expect(201);
    return res.body.id;
  }

  async function addHost(streamId: string, identity: string): Promise<RtcCredentials> {
    const res = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/hosts`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity, role: 'HOST' })
      .expect(201);
    return { token: res.body.rtc.token, endpoint: res.body.rtc.endpoint, iceServers: res.body.rtc.iceServers, roomName: res.body.rtc.roomName };
  }

  async function createViewerToken(streamId: string, identity: string): Promise<RtcCredentials> {
    const res = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/viewer-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity })
      .expect(201);
    // `rtc`-nested, exactly like the host response: a viewer credential
    // carries chat alongside RTC. Reading the top level instead gave
    // `undefined` for every field, which surfaced in the browser as
    // "RTC token is malformed" instead of as a failed assertion here.
    return {
      token: res.body.rtc.token,
      endpoint: res.body.rtc.endpoint,
      iceServers: res.body.rtc.iceServers,
      roomName: res.body.rtc.roomName,
    };
  }

  it('a host publishes camera + effects to a real stream, through its real lifecycle, without disconnecting', async () => {
    const streamId = await createStream();
    const hostCreds = await addHost(streamId, 'alice');

    await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/start`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);

    let hostCtx: BrowserContext | undefined;
    try {
      hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const hostPage = await hostCtx.newPage();

      await hostPage.goto(harnessUrl(harnessUrlBase, { endpoint: signalingEndpoint, role: 'publisher', creds: hostCreds, preset: 'vivid' }));
      await hostPage.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 30_000 });

      const state = await hostPage.evaluate(() => (window as unknown as { __state: Record<string, unknown> }).__state);
      expect(state.connectionState).toBe('connected');
      expect(state.effectsAttached).toBe(true);
      expect(['webgl2', 'canvas2d']).toContain(state.engineKind);
      expect(state.effectsError).toBeUndefined();

      // Switch presets mid-stream: the host's room/connection must be unaffected.
      await hostPage.evaluate(() => (window as unknown as { __clearEffects: () => void }).__clearEffects());
      expect(
        await hostPage.evaluate(() => (window as unknown as { __state: { connectionState: string } }).__state.connectionState),
      ).toBe('connected');

      await hostCtx.close();
      hostCtx = undefined;
    } finally {
      await hostCtx?.close();
    }

    // Ending the stream is unaffected by anything effects-related having happened on the host's video.
    const ended = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/end`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);
    expect(ended.body.status).toBe('ENDED');
  });

  // See the module doc: blocked on the same environment-level ICE/subscription
  // issue as effects-rtc.e2e-spec.ts's skipped test, not anything Live
  // Streaming- or Effects-specific. Re-enable alongside that one.
  it('a viewer receives the host-processed video, and chat/reactions keep working throughout', async () => {
    const streamId = await createStream();
    const hostCreds = await addHost(streamId, 'alice');
    const viewerCreds = await createViewerToken(streamId, 'carol');
    await request(app.getHttpServer()).post(`/v1/live-streams/${streamId}/start`).set('Authorization', `Bearer ${apiKey}`).expect(201);

    let hostCtx: BrowserContext | undefined;
    let viewerCtx: BrowserContext | undefined;
    try {
      hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      viewerCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const hostPage = await hostCtx.newPage();
      const viewerPage = await viewerCtx.newPage();
      const hostLog = collectPageDiagnostics(hostPage, 'host');
      const viewerLog = collectPageDiagnostics(viewerPage, 'viewer');

      await hostPage.goto(harnessUrl(harnessUrlBase, { endpoint: signalingEndpoint, role: 'publisher', creds: hostCreds, preset: 'vivid' }));
      await waitForPage(
        hostPage,
        () => (window as unknown as { __ready?: boolean }).__ready === true,
        hostLog,
        'the host harness to become ready',
      );

      await viewerPage.goto(harnessUrl(harnessUrlBase, { endpoint: signalingEndpoint, role: 'subscriber', creds: viewerCreds }));
      await waitForPage(
        viewerPage,
        () => (window as unknown as { __state: { remoteTrackSubscribed?: boolean } }).__state.remoteTrackSubscribed === true,
        () => `${viewerLog()}\n\n${hostLog()}`,
        "the viewer to receive the host's track",
      );

      // Chat/reactions continuity is covered at the API level by the existing
      // live-streams.e2e-spec.ts suite; this test's job is specifically the
      // video path once the viewer subscribes.
      await request(app.getHttpServer()).post(`/v1/live-streams/${streamId}/end`).set('Authorization', `Bearer ${apiKey}`).expect(201);
    } finally {
      await hostCtx?.close();
      await viewerCtx?.close();
    }
  });
});
