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
 * Real-browser end-to-end test of Phase 16 (Livqeno Effects) on RTC: a real
 * Chromium instance, a real SFU connection (`docker compose up -d`,
 * same as every other suite in this file's family), and the actual
 * `@ravenkash/rtc`/`@ravenkash/effects` browser builds. Chrome's fake camera
 * device stands in for real hardware; the pipeline runs against it exactly
 * as it would against a real feed.
 *
 * # A note on the two-participant test
 *
 * It was `.skip`ped for a long time, attributed to this sandbox's network
 * handling. That attribution was wrong, and the skip was hiding a real
 * bug: the adapter matched an arriving track to its announcement by
 * `RTCTrackEvent.track.id`, which is **not** the remote track id. Chrome
 * mints a fresh local one and ignores the `msid` that carries the real
 * one. Every arriving track was therefore parked as "media arrived
 * early", and no subscription ever completed. It failed silently, as a
 * subscription that never finished, not as an error, which is why
 * only a real browser caught it. Fixed by reading the id from the
 * remote SDP's `a=msid:` line, located by the transceiver's mid; pinned
 * in `packages/sdk/test/raven-adapter.spec.ts`.
 *
 * The lesson worth keeping: a skipped test with a plausible external
 * explanation is a good place for a bug to hide. Both tests run now.
 *
 * Requires Chromium to be installed for Playwright:
 *   npx playwright install chromium
 */
jest.setTimeout(120_000);

const HARNESS_DIR = join(__dirname, 'e2e-harness');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.map': 'application/json',
};

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
}

/**
 * Points the browser at *this* suite's app rather than at whatever
 * `API_PUBLIC_URL` names.
 *
 * The mint response's `endpoint` is derived from `API_PUBLIC_URL`, which
 * on a developer's machine is the compose API on :4100: a different
 * process reading a different database. A browser sent there would try to
 * join a room that only exists in this suite's database and be told
 * `NO_RTC_CAPACITY`, because the room row the allocator needs is not
 * there. Under LiveKit this never came up: every suite shared one
 * database, so "some Livqeno API" was good enough. It is not good enough
 * now that the e2e suite runs against a scratch database of its own.
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
  opts: { roomId: string; role: 'publisher' | 'subscriber'; creds: RtcCredentials; endpoint: string; preset?: string },
): string {
  const params = new URLSearchParams({
    roomId: opts.roomId,
    role: opts.role,
    token: opts.creds.token,
    endpoint: opts.endpoint,
    iceServers: JSON.stringify(opts.creds.iceServers),
  });
  if (opts.preset) params.set('preset', opts.preset);
  return `${baseUrl}/rtc-effects.html?${params.toString()}`;
}

describe('Livqeno Effects — RTC (real browser e2e)', () => {
  let app: INestApplication;
  let harnessServer: Server;
  let harnessUrlBase: string;
  let signalingEndpoint: string;
  let browser: Browser;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;
  let roomId: string;
  let roomName: string;

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

    // `room.join` allocates a *registered* SFU, and the compose node
    // registers with the compose API's database instead of this suite's.
    // Without this row the browser's join fails with NO_RTC_CAPACITY and
    // the harness never reaches `__ready`, which reads as a timeout with
    // no obvious cause.
    await registerLocalSfu(app);

    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `effects-rtc-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `effects-rtc-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    roomName = `effects-e2e-${suffix}`;
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: roomName })
      .expect(201);
    roomId = room.body.id;

    const harness = await startHarnessServer();
    harnessServer = harness.server;
    harnessUrlBase = harness.url;

    // Chrome's built-in synthetic camera: a moving color/gradient pattern,
    // not a blank frame, so the effects pipeline has real pixel content to
    // transform (see below: `engineKind` must not be `passthrough`).
    browser = await chromium.launch({
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => harnessServer.close(() => resolve()));
    await app.close();
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

  it('connects to a real SFU room, runs a real GPU/CPU pipeline against a real camera-like track, and supports the full lifecycle without disconnecting', async () => {
    const publisherCreds = await mintToken('alice', true);
    let publisherCtx: BrowserContext | undefined;
    try {
      publisherCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const publisherPage = await publisherCtx.newPage();
      const publisherLog = collectPageDiagnostics(publisherPage, 'publisher');

      await publisherPage.goto(
        harnessUrl(harnessUrlBase, {
          endpoint: signalingEndpoint,
          roomId: roomName,
          role: 'publisher',
          creds: publisherCreds,
          preset: 'cinematic',
        }),
      );
      await waitForPage(
        publisherPage,
        () => (window as unknown as { __ready?: boolean }).__ready === true,
        publisherLog,
        'the publisher harness to become ready',
      );

      const state = () =>
        publisherPage.evaluate(() => (window as unknown as { __state: Record<string, unknown> }).__state);

      const initial = await state();
      expect(initial.connectionState).toBe('connected');
      expect(initial.effectsAttached).toBe(true);
      expect(['webgl2', 'canvas2d']).toContain(initial.engineKind); // real fake-camera pixels went through a real engine, not passthrough
      expect(initial.effectsError).toBeUndefined();

      // Disable the effect mid-call. RTC must keep running.
      await publisherPage.evaluate(() => (window as unknown as { __disableEffects: () => void }).__disableEffects());
      await publisherPage.waitForFunction(
        () => (window as unknown as { __pipeline: { isEnabled: boolean } }).__pipeline.isEnabled === false,
      );
      expect((await state()).connectionState).toBe('connected');

      // Re-enable, then remove the effect entirely.
      await publisherPage.evaluate(() => (window as unknown as { __enableEffects: () => void }).__enableEffects());
      await publisherPage.evaluate(() => (window as unknown as { __clearEffects: () => void }).__clearEffects());
      const effectsCountAfterClear = await publisherPage.evaluate(
        () => (window as unknown as { __pipeline: { effects: unknown[] } }).__pipeline.effects.length,
      );
      expect(effectsCountAfterClear).toBe(0);
      expect((await state()).connectionState).toBe('connected');

      // Detach entirely: reverts to the unmodified camera track, room stays up.
      await publisherPage.evaluate(() =>
        (window as unknown as { __detachEffects: () => Promise<void> }).__detachEffects(),
      );
      await new Promise((r) => setTimeout(r, 500));
      expect((await state()).connectionState).toBe('connected');
    } finally {
      await publisherCtx?.close();
    }
  });

  // Real browser-to-browser media through Livqeno's SFU: two Chromium
  // contexts, a real camera-like track, a real GPU pipeline on the
  // publisher, and the subscriber must actually decode frames: not
  // merely receive a track object. See the module doc for why this was
  // skipped, and what the skip was hiding.
  it('a viewer receives the publisher-processed video, and effect changes never disconnect either side', async () => {
    const publisherCreds = await mintToken('alice', true);
    const subscriberCreds = await mintToken('bob', false);

    let publisherCtx: BrowserContext | undefined;
    let subscriberCtx: BrowserContext | undefined;
    try {
      publisherCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      subscriberCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const publisherPage = await publisherCtx.newPage();
      const subscriberPage = await subscriberCtx.newPage();
      const publisherLog = collectPageDiagnostics(publisherPage, 'publisher');
      const subscriberLog = collectPageDiagnostics(subscriberPage, 'subscriber');

      await publisherPage.goto(
        harnessUrl(harnessUrlBase, {
          endpoint: signalingEndpoint,
          roomId: roomName,
          role: 'publisher',
          creds: publisherCreds,
          preset: 'cinematic',
        }),
      );
      await waitForPage(
        publisherPage,
        () => (window as unknown as { __ready?: boolean }).__ready === true,
        publisherLog,
        'the publisher harness to become ready',
      );

      await subscriberPage.goto(
        harnessUrl(harnessUrlBase, {
          endpoint: signalingEndpoint,
          roomId: roomName,
          role: 'subscriber',
          creds: subscriberCreds,
        }),
      );
      await waitForPage(
        subscriberPage,
        () =>
          (window as unknown as { __state: { remoteTrackSubscribed?: boolean } }).__state.remoteTrackSubscribed ===
          true,
        () => `${subscriberLog()}\n\n${publisherLog()}`,
        "the subscriber to receive the publisher's track",
      );

      await subscriberPage.waitForFunction(() => {
        const video = document.getElementById('remoteVideo') as HTMLVideoElement;
        return video.readyState >= 2 && video.videoWidth > 0;
      });

      await publisherPage.evaluate(() => (window as unknown as { __disableEffects: () => void }).__disableEffects());
      expect(
        await subscriberPage.evaluate(
          () => (window as unknown as { __state: { connectionState: string } }).__state.connectionState,
        ),
      ).toBe('connected');

      await publisherPage.evaluate(() => (window as unknown as { __clearEffects: () => void }).__clearEffects());
      await publisherPage.evaluate(() =>
        (window as unknown as { __detachEffects: () => Promise<void> }).__detachEffects(),
      );
      expect(
        await subscriberPage.evaluate(
          () => (window as unknown as { __state: { remoteTrackSubscribed: boolean } }).__state.remoteTrackSubscribed,
        ),
      ).toBe(true);
    } finally {
      await publisherCtx?.close();
      await subscriberCtx?.close();
    }
  });
});
