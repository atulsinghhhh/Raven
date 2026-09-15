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
import { collectPageDiagnostics, waitForPage } from './helpers/page-diagnostics';

/**
 * Real end-to-end check of `raven_live` (Flutter) against a real backend:
 * a real NestJS app, a real registered SFU, a real Flutter *Web* build
 * of `sdks/flutter/raven_live`/`raven_rtc` as the host, and a real
 * Chromium tab running the actual `@ravenkash/rtc` browser build as the
 * viewer. Nothing here is mocked — same posture as
 * `effects-live-streaming.e2e-spec.ts`, whose harness-serving and
 * credential-minting pattern this borrows directly.
 *
 * # Why Flutter *Web* and not a real device/simulator
 *
 * There is no Flutter integration-test driver in this repo (nothing
 * named `flutter_check`, `integration_test`, or similar existed before
 * this file), and this sandbox has no iOS/Android device or simulator
 * with camera access. `flutter_webrtc` does support Flutter Web with a
 * real `getUserMedia` (see `flutter_check/live_host`'s module doc), so a
 * `flutter build web` release build, served statically and driven by
 * Playwright with Chrome's fake camera device, is the most real
 * end-to-end path actually available here. It exercises the *same*
 * `raven_rtc` engine (signaling, negotiation, `applyJoinedState`, data
 * channel) that a native build would — the platform split lives in
 * `flutter_webrtc`, below `raven_rtc`, not inside it — but a native
 * device pass is not something this run can claim.
 *
 * # Why a scratch database
 *
 * Same reasoning as every other suite in this file's family:
 * `guard-database-target.ts` refuses to let this run against the shared
 * Supabase database `DATABASE_URL` names by default. Point it at a
 * scratch Postgres (see `docs/deployment/managed-postgres.md`) before
 * running this file.
 *
 * # Media validation
 *
 * The viewer harness (`e2e-harness/live-viewer.js`) captures the raw
 * `RTCPeerConnection` the SDK creates and reads `framesDecoded` /
 * `bytesReceived` straight off a real `getStats()` inbound-rtp report —
 * not the SDK's own derived `TrackStats`. The test samples it twice,
 * several seconds apart, and requires both to have strictly increased.
 * Signaling success (`connectionState: 'connected'`, a subscribed track)
 * is necessary but explicitly not sufficient here.
 */
jest.setTimeout(180_000);

const LIVE_HOST_WEB_DIR = join(__dirname, '..', '..', '..', 'flutter_check', 'live_host', 'build', 'web');
const VIEWER_HARNESS_DIR = join(__dirname, 'e2e-harness');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};

function startStaticServer(rootDir: string, defaultFile: string): Promise<{ server: Server; url: string }> {
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

/** Same rationale as effects-live-streaming.e2e-spec.ts's localSignalingEndpoint(). */
function localSignalingEndpoint(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('app is not listening — call app.listen(0) before minting credentials');
  return `ws://127.0.0.1:${port}/v1/rtc`;
}

interface RtcCredentialsBody {
  streamId: string;
  role: string;
  rtc: { token: string; endpoint: string; iceServers: unknown[]; roomName: string; roomId: string };
  chat?: unknown;
  chatRootMessageId?: string;
}

interface FrameStats {
  timestamp: number;
  framesDecoded: number | null;
  framesReceived: number | null;
  bytesReceived: number | null;
  packetsReceived: number | null;
}

describe('raven_live — Flutter host to browser viewer (real E2E)', () => {
  let app: INestApplication;
  let hostServer: Server;
  let hostUrlBase: string;
  let viewerServer: Server;
  let viewerUrlBase: string;
  let signalingEndpoint: string;
  let browser: Browser;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;

  beforeAll(async () => {
    if (!existsSync(join(LIVE_HOST_WEB_DIR, 'index.html'))) {
      throw new Error(
        `No Flutter web build at ${LIVE_HOST_WEB_DIR}.\n` + 'Run: (cd flutter_check/live_host && flutter build web)',
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
      .send({ email: `flutter-live-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `flutter-live-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const hostStatic = await startStaticServer(LIVE_HOST_WEB_DIR, 'index.html');
    hostServer = hostStatic.server;
    hostUrlBase = hostStatic.url;

    const viewerStatic = await startStaticServer(VIEWER_HARNESS_DIR, 'live-viewer.html');
    viewerServer = viewerStatic.server;
    viewerUrlBase = viewerStatic.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (hostServer ? hostServer.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve) => (viewerServer ? viewerServer.close(() => resolve()) : resolve()));
    await app?.close();
  });

  // A fresh Chromium per test, not one shared across the suite: Chrome's
  // fake camera device is a single virtual resource, and the previous
  // test's context releasing it doesn't always beat the next context's
  // getUserMedia call, surfacing as a flaky, environment-only
  // "already in use by another application" — nothing to do with the
  // SDK under test.
  beforeEach(async () => {
    browser = await chromium.launch({
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
  });

  afterEach(async () => {
    await browser?.close();
  });

  async function createStream(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: `Flutter Live E2E ${suffix}`, hostIdentity: 'alice' })
      .expect(201);
    return res.body.id;
  }

  async function addHost(streamId: string, identity: string): Promise<RtcCredentialsBody> {
    const res = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/hosts`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity, role: 'HOST' })
      .expect(201);
    return res.body;
  }

  async function createViewerToken(streamId: string, identity: string): Promise<RtcCredentialsBody> {
    const res = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/viewer-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity })
      .expect(201);
    return res.body;
  }

  function flutterAppUrl(creds: RtcCredentialsBody): string {
    // RTC-only for this check (see flutter_check/live_host's module doc):
    // chat is stripped app-side, but the endpoint override matters here —
    // the credential's own `rtc.endpoint` is derived from API_PUBLIC_URL,
    // which names the compose API on :4100, not this suite's in-process
    // app. Same fix as localSignalingEndpoint() everywhere else in this
    // file's family.
    const patched: RtcCredentialsBody = { ...creds, rtc: { ...creds.rtc, endpoint: signalingEndpoint } };
    return `${hostUrlBase}/index.html?creds=${encodeURIComponent(JSON.stringify(patched))}`;
  }

  function liveViewerUrl(creds: RtcCredentialsBody): string {
    const params = new URLSearchParams({
      roomId: creds.rtc.roomName,
      token: creds.rtc.token,
      endpoint: signalingEndpoint,
      iceServers: JSON.stringify(creds.rtc.iceServers),
    });
    return `${viewerUrlBase}/live-viewer.html?${params.toString()}`;
  }

  /** The existing rtc-effects harness, reused as a browser *host* for the reverse-direction check. */
  function browserHostUrl(creds: RtcCredentialsBody): string {
    const params = new URLSearchParams({
      roomId: creds.rtc.roomId,
      role: 'publisher',
      token: creds.rtc.token,
      endpoint: signalingEndpoint,
      iceServers: JSON.stringify(creds.rtc.iceServers),
    });
    return `${viewerUrlBase}/rtc-effects.html?${params.toString()}`;
  }

  it(
    'a Flutter host publishes camera+mic to a real live stream, and a real browser viewer receives ' +
      'actual increasing video frames/bytes, not just signaling',
    async () => {
      const streamId = await createStream();
      const hostCreds = await addHost(streamId, 'alice');

      await request(app.getHttpServer())
        .post(`/v1/live-streams/${streamId}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);

      let hostCtx: BrowserContext | undefined;
      let viewerCtx: BrowserContext | undefined;
      try {
        hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
        const hostPage: Page = await hostCtx.newPage();
        const hostLog = collectPageDiagnostics(hostPage, 'flutter-host');

        console.log(`[test] host stream id = ${streamId}, participant identity = alice`);
        await hostPage.goto(flutterAppUrl(hostCreds));
        await waitForPage(
          hostPage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          hostLog,
          'the Flutter host to report ready',
          60_000,
        );

        const hostState = () =>
          hostPage.evaluate(() => (window as unknown as { __state: Record<string, unknown> }).__state);

        const initialHostState = await hostState();
        console.log('[test] host state at ready:', JSON.stringify(initialHostState));
        expect(initialHostState.phase).not.toBe('failed');
        expect(initialHostState.connectionState).toBe('connected');
        expect(initialHostState.cameraPublished).toBe(true);
        expect(initialHostState.microphonePublished).toBe(true);

        const viewerCreds = await createViewerToken(streamId, 'bob');
        viewerCtx = await browser.newContext();
        const viewerPage: Page = await viewerCtx.newPage();
        const viewerLog = collectPageDiagnostics(viewerPage, 'browser-viewer');

        console.log('[test] viewer participant identity = bob');
        await viewerPage.goto(liveViewerUrl(viewerCreds));
        await waitForPage(
          viewerPage,
          () =>
            (window as unknown as { __state: { remoteTrackSubscribed?: boolean } }).__state.remoteTrackSubscribed ===
            true,
          () => `${viewerLog()}\n\n${hostLog()}`,
          "the browser viewer to subscribe to the Flutter host's track",
        );

        // trackSubscribed can fire a moment before ICE/DTLS finish; wait
        // for connectionState to catch up rather than racing it (same
        // "join() resolves before media" note as the JS harnesses').
        await waitForPage(
          viewerPage,
          () =>
            (window as unknown as { __state: { connectionState?: string } }).__state.connectionState === 'connected',
          () => `${viewerLog()}\n\n${hostLog()}`,
          "the browser viewer's connectionState to reach 'connected'",
        );

        const viewerState = await viewerPage.evaluate(
          () => (window as unknown as { __state: Record<string, unknown> }).__state,
        );
        console.log('[test] viewer state at subscription:', JSON.stringify(viewerState));
        expect(viewerState.connectionState).toBe('connected');
        expect(viewerState.remoteTrackSubscribed).toBe(true);

        // --- Actual media validation: raw getStats(), sampled twice. ---
        const readStats = () =>
          viewerPage.evaluate(() => (window as unknown as { __stats: () => Promise<FrameStats | null> }).__stats());

        // Give the decoder a moment past "track subscribed" before the
        // first sample: subscription and the first decoded frame are not
        // the same instant.
        await new Promise((r) => setTimeout(r, 1500));
        const first = await readStats();
        console.log('[test] frame stats sample 1:', JSON.stringify(first));
        expect(first).not.toBeNull();
        expect(first!.framesDecoded ?? 0).toBeGreaterThanOrEqual(0);

        const OBSERVATION_WINDOW_MS = 5000;
        await new Promise((r) => setTimeout(r, OBSERVATION_WINDOW_MS));
        const second = await readStats();
        console.log('[test] frame stats sample 2:', JSON.stringify(second));
        expect(second).not.toBeNull();

        console.log(
          `[test] over ${OBSERVATION_WINDOW_MS}ms: framesDecoded ${first!.framesDecoded} -> ${second!.framesDecoded}, ` +
            `bytesReceived ${first!.bytesReceived} -> ${second!.bytesReceived}`,
        );

        expect(second!.framesDecoded ?? -1).toBeGreaterThan(first!.framesDecoded ?? -1);
        expect(second!.bytesReceived ?? -1).toBeGreaterThan(first!.bytesReceived ?? -1);
        expect(second!.framesDecoded ?? 0).toBeGreaterThan(0);

        // --- Stop the host cleanly, then end the stream server-side. ---
        await hostPage.evaluate(() => (window as unknown as { __leave: () => void }).__leave());
        await hostCtx.close();
        hostCtx = undefined;

        const ended = await request(app.getHttpServer())
          .post(`/v1/live-streams/${streamId}/end`)
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(201);
        expect(ended.body.status).toBe('ENDED');

        const fetched = await request(app.getHttpServer())
          .get(`/v1/live-streams/${streamId}`)
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
        expect(fetched.body.status).toBe('ENDED');
        console.log(`[test] stream ${streamId} confirmed ENDED`);
      } finally {
        await hostCtx?.close();
        await viewerCtx?.close();
      }
    },
  );

  // Reverse direction (spec: "test the reverse direction if applicable").
  // Exercises raven_rtc's *subscribe* path specifically — RavenEngine's
  // incoming-track/announcement matching, applyJoinedState — through the
  // real Flutter build, with a real browser as the publisher this time.
  // Lighter than the primary test: raven_rtc exposes no public getStats()
  // equivalent to the JS SDK's, so this confirms the Flutter viewer's
  // participant/track state reflects the subscription correctly, not
  // frame-level decode counts. See the final report for that distinction.
  it('a real browser host publishes to a real live stream, and a Flutter viewer subscribes to it', async () => {
    const streamId = await createStream();
    const hostCreds = await addHost(streamId, 'carol');

    await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/start`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);

    let hostCtx: BrowserContext | undefined;
    let viewerCtx: BrowserContext | undefined;
    try {
      hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const hostPage: Page = await hostCtx.newPage();
      const hostLog = collectPageDiagnostics(hostPage, 'browser-host');

      await hostPage.goto(browserHostUrl(hostCreds));
      await waitForPage(
        hostPage,
        () => (window as unknown as { __ready?: boolean }).__ready === true,
        hostLog,
        'the browser host harness to become ready',
      );
      expect(
        await hostPage.evaluate(
          () => (window as unknown as { __state: { connectionState: string } }).__state.connectionState,
        ),
      ).toBe('connected');

      const viewerCreds = await createViewerToken(streamId, 'dave');
      viewerCtx = await browser.newContext();
      const viewerPage: Page = await viewerCtx.newPage();
      const viewerLog = collectPageDiagnostics(viewerPage, 'flutter-viewer');

      await viewerPage.goto(flutterAppUrl(viewerCreds)); // same static app; role comes from credentials, not a URL flag
      await waitForPage(
        viewerPage,
        () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
        viewerLog,
        'the Flutter viewer to report ready',
        60_000,
      );

      const viewerReadyState = await viewerPage.evaluate(
        () => (window as unknown as { __state: Record<string, unknown> }).__state,
      );
      console.log('[test] flutter viewer state at ready:', JSON.stringify(viewerReadyState));
      expect(viewerReadyState.phase).not.toBe('failed');
      expect(viewerReadyState.isHost).toBe(false);

      await waitForPage(
        viewerPage,
        () => {
          const sources = (window as unknown as { __state: { remoteLiveSources?: Record<string, string[]> } }).__state
            .remoteLiveSources;
          return !!sources && Object.values(sources).some((kinds) => kinds.includes('camera'));
        },
        () => `${viewerLog()}\n\n${hostLog()}`,
        "the Flutter viewer to see the browser host's camera as a live source",
      );

      const subscribedState = await viewerPage.evaluate(
        () => (window as unknown as { __state: Record<string, unknown> }).__state,
      );
      console.log('[test] flutter viewer state once subscribed:', JSON.stringify(subscribedState));
      expect(subscribedState.connectionState).toBe('connected');

      await request(app.getHttpServer())
        .post(`/v1/live-streams/${streamId}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
    } finally {
      await hostCtx?.close();
      await viewerCtx?.close();
    }
  });
});
