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
 * Real E2E check of **Flutter-to-Flutter** media over the *published*
 * `raven_rtc` package (`^0.1.3` in flutter_check/published_consumer's
 * pubspec.yaml — no path override, so this resolves from pub.dev exactly
 * as an integrator's app would).
 *
 * Every other real-browser RTC suite in this file's family pairs a
 * Flutter participant against a real browser running `@ravenkash/rtc`
 * (effects-rtc, flutter-live-streaming, flutter-rtc-datachannel-pubdev).
 * None of them cover two `raven_rtc` engines talking to each other, which
 * `flutter_check/README.md`'s "Known gaps" section has flagged since this
 * harness family was written. This suite exists because a field report
 * against 0.1.3 reproduced camera=false — the exact pre-0.1.3 symptom —
 * in an all-Flutter room, after the 0.1.3 glare-recovery fix had already
 * been verified clean against a browser counterparty in both directions.
 * If the bug is specific to Flutter-as-both-sides, only a suite shaped
 * like this one can catch it.
 *
 * Three Flutter Web contexts, one plain (non-`raven_live`) room:
 * alice publishes first, bob joins and publishes second (an already-live
 * room gaining a publisher), carol joins last without publishing (a
 * viewer arriving mid-call). Matches the field report's own scenario
 * table exactly.
 */
jest.setTimeout(180_000);

const VIDEO_WEB_DIR = join(__dirname, '..', '..', '..', 'flutter_check', 'published_consumer', 'build', 'web_video');

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

function localSignalingEndpoint(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('app is not listening — call app.listen(0) before minting credentials');
  return `ws://127.0.0.1:${port}/v1/rtc`;
}

interface RtcCredentials {
  token: string;
  endpoint: string;
  iceServers: unknown[];
}

function flutterAppUrl(
  baseUrl: string,
  opts: { roomId: string; publish: boolean; creds: RtcCredentials; endpoint: string },
): string {
  const params = new URLSearchParams({
    roomId: opts.roomId,
    token: opts.creds.token,
    endpoint: opts.endpoint,
    iceServers: JSON.stringify(opts.creds.iceServers),
    publish: opts.publish ? 'true' : 'false',
  });
  return `${baseUrl}/index.html?${params.toString()}`;
}

type FlutterVideoState = {
  phase?: string;
  connectionState?: string;
  ready?: boolean;
  cameraPublished?: boolean;
  microphonePublished?: boolean;
  participantIdentities?: string[];
  remoteLiveSources?: Record<string, string[]>;
  error?: { code: string; message: string };
  roomError?: { code: string; message: string };
};

describe('raven_rtc (published pub.dev package) — Flutter-to-Flutter multiparty (real E2E)', () => {
  let app: INestApplication;
  let videoServer: Server;
  let videoUrlBase: string;
  let signalingEndpoint: string;
  let browser: Browser;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;
  let roomId: string;

  beforeAll(async () => {
    if (!existsSync(join(VIDEO_WEB_DIR, 'index.html'))) {
      throw new Error(
        `No Flutter web build at ${VIDEO_WEB_DIR}.\n` +
          'Run: (cd flutter_check/published_consumer && flutter build web --release -t lib/main_video.dart -o build/web_video)',
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
      .send({ email: `flutter-multiparty-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `flutter-multiparty-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: `flutter-multiparty-e2e-${suffix}` })
      .expect(201);
    roomId = room.body.id;

    const videoStatic = await startStaticServer(VIDEO_WEB_DIR, 'index.html');
    videoServer = videoStatic.server;
    videoUrlBase = videoStatic.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => videoServer.close(() => resolve()));
    await app.close();
  });

  beforeEach(async () => {
    browser = await chromium.launch({
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
  });

  afterEach(async () => {
    await browser?.close();
  });

  async function mintToken(identity: string, publish: boolean): Promise<RtcCredentials> {
    const res = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/rtc-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        participantIdentity: identity,
        permissions: { join: true, subscribe: true, publish, publishAudio: publish, publishVideo: publish },
      })
      .expect(201);
    return { token: res.body.token, endpoint: res.body.endpoint, iceServers: res.body.iceServers };
  }

  async function readState(page: Page): Promise<FlutterVideoState> {
    return page.evaluate(() => (window as unknown as { __state: FlutterVideoState }).__state);
  }

  it(
    'alice publishes, bob joins and publishes into the live room, carol joins mid-call as a viewer — ' +
      "every participant must see every other publisher's camera as live",
    async () => {
      let aliceCtx: BrowserContext | undefined;
      let bobCtx: BrowserContext | undefined;
      let carolCtx: BrowserContext | undefined;
      try {
        // --- alice: first publisher into an empty room. ---
        const aliceCreds = await mintToken('alice', true);
        aliceCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
        const alicePage = await aliceCtx.newPage();
        const aliceLog = collectPageDiagnostics(alicePage, 'alice');

        await alicePage.goto(
          flutterAppUrl(videoUrlBase, { roomId, publish: true, creds: aliceCreds, endpoint: signalingEndpoint }),
        );
        await waitForPage(
          alicePage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          aliceLog,
          'alice to report ready',
          60_000,
        );

        const aliceReady = await readState(alicePage);
        console.log('[test] alice state at ready:', JSON.stringify(aliceReady));
        expect(aliceReady.phase).not.toBe('failed');
        expect(aliceReady.cameraPublished).toBe(true);
        expect(aliceReady.microphonePublished).toBe(true);

        // --- bob: second publisher, joining a room that's already live. ---
        const bobCreds = await mintToken('bob', true);
        bobCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
        const bobPage = await bobCtx.newPage();
        const bobLog = collectPageDiagnostics(bobPage, 'bob');

        await bobPage.goto(
          flutterAppUrl(videoUrlBase, { roomId, publish: true, creds: bobCreds, endpoint: signalingEndpoint }),
        );
        await waitForPage(
          bobPage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          bobLog,
          'bob to report ready',
          60_000,
        );

        const bobReady = await readState(bobPage);
        console.log('[test] bob state at ready:', JSON.stringify(bobReady));
        expect(bobReady.phase).not.toBe('failed');
        expect(bobReady.cameraPublished).toBe(true);

        // The field report's exact failure: does bob's own roster show
        // alice's camera live? This is bob's engine matching alice's
        // published track, not alice's own self-report.
        await waitForPage(
          bobPage,
          () => {
            const sources = (window as unknown as { __state: { remoteLiveSources?: Record<string, string[]> } }).__state
              .remoteLiveSources;
            return !!sources?.['alice']?.includes('camera');
          },
          () => `${bobLog()}\n\n${aliceLog()}`,
          "bob's roster to show alice's camera as live",
        );
        const bobSeesAlice = await readState(bobPage);
        console.log('[test] bob sees:', JSON.stringify(bobSeesAlice.remoteLiveSources));
        expect(bobSeesAlice.remoteLiveSources?.['alice']).toContain('camera');

        // Symmetric check: alice must also see bob, now that bob has
        // published into the room after her.
        await waitForPage(
          alicePage,
          () => {
            const sources = (window as unknown as { __state: { remoteLiveSources?: Record<string, string[]> } }).__state
              .remoteLiveSources;
            return !!sources?.['bob']?.includes('camera');
          },
          () => `${aliceLog()}\n\n${bobLog()}`,
          "alice's roster to show bob's camera as live",
        );
        const aliceSeesBob = await readState(alicePage);
        console.log('[test] alice sees:', JSON.stringify(aliceSeesBob.remoteLiveSources));
        expect(aliceSeesBob.remoteLiveSources?.['bob']).toContain('camera');

        // --- carol: viewer joining mid-call, after two publishers already exist. ---
        const carolCreds = await mintToken('carol', false);
        carolCtx = await browser.newContext();
        const carolPage = await carolCtx.newPage();
        const carolLog = collectPageDiagnostics(carolPage, 'carol');

        await carolPage.goto(
          flutterAppUrl(videoUrlBase, { roomId, publish: false, creds: carolCreds, endpoint: signalingEndpoint }),
        );
        await waitForPage(
          carolPage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          carolLog,
          'carol to report ready',
          60_000,
        );

        const carolReady = await readState(carolPage);
        console.log('[test] carol state at ready:', JSON.stringify(carolReady));
        expect(carolReady.phase).not.toBe('failed');

        await waitForPage(
          carolPage,
          () => {
            const sources = (window as unknown as { __state: { remoteLiveSources?: Record<string, string[]> } }).__state
              .remoteLiveSources;
            return !!sources?.['alice']?.includes('camera') && !!sources?.['bob']?.includes('camera');
          },
          () => `${carolLog()}\n\n${aliceLog()}\n\n${bobLog()}`,
          "carol's roster to show both alice's and bob's camera as live",
        );
        const carolSeesBoth = await readState(carolPage);
        console.log('[test] carol sees:', JSON.stringify(carolSeesBoth.remoteLiveSources));
        expect(carolSeesBoth.remoteLiveSources?.['alice']).toContain('camera');
        expect(carolSeesBoth.remoteLiveSources?.['bob']).toContain('camera');
      } finally {
        await aliceCtx?.close();
        await bobCtx?.close();
        await carolCtx?.close();
      }
    },
  );
});
