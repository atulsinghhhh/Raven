import { createReadStream, existsSync } from 'fs';
import { createServer, type Server } from 'http';
import { extname, join, normalize } from 'path';
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
 * The regression floor under the Live Streaming capacity rig.
 *
 * `scripts/capacity` is where the actual capacity numbers come from: it
 * runs its own API and SFU processes, scales to a hundred viewers, and
 * takes half an hour to an evening depending on the scenario. None of
 * that belongs in a Jest suite, and none of it runs in CI.
 *
 * What does belong here is the property every one of those numbers rests
 * on, at a size CI can afford: **several real viewers subscribed to one
 * real host are demonstrably decoding frames, and keep decoding them.**
 * If that breaks, every capacity figure in
 * `docs/production/live-streaming-media-capacity.md` becomes a claim about
 * code that no longer works, and it should break here first — in a
 * ninety-second test — rather than the next time someone spends an
 * evening on the rig.
 *
 * The assertion is deliberately the same one the rig makes, and
 * deliberately not `connectionState === 'connected'`: two samples a
 * second apart, `framesDecoded` strictly increasing in both the WebRTC
 * stats and the video element's own counter. A connected PeerConnection
 * carrying nothing satisfies the weaker check and is exactly the failure
 * this exists to catch.
 *
 * Needs the compose SFU (`docker compose up -d sfu`), like the other
 * browser suites here.
 */
jest.setTimeout(180_000);

/** Small enough for CI, large enough that fan-out is genuinely exercised. */
const VIEWERS = 4;
const HARNESS_DIR = normalize(join(__dirname, '..', '..', '..', 'scripts', 'capacity', 'harness'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Points the browser at *this* suite's app rather than at whatever
 * `API_PUBLIC_URL` names.
 *
 * The mint response's `endpoint` is derived from `API_PUBLIC_URL`, which
 * on a developer's machine is the compose API on :4100 — a different
 * process reading a different database. A browser sent there tries to
 * join a room that only exists in this suite's scratch database and gets
 * `NO_RTC_CAPACITY`. Same fix as `effects-live-streaming.e2e-spec.ts`'s
 * `localSignalingEndpoint`.
 */
function localSignalingEndpoint(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) {
    throw new Error('app is not listening — call app.listen(0) before minting credentials');
  }
  return `ws://127.0.0.1:${port}/v1/rtc`;
}

function startHarnessServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const requested = (req.url ?? '/').split('?')[0];
    const filePath = normalize(join(HARNESS_DIR, requested));
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
      resolve({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` });
    });
  });
}

interface ViewerSample {
  id: string;
  live: boolean;
  raw?: { video?: { framesDecoded: number; bytesReceived: number; packetsReceived: number; timestamp: number } | null };
  elementTotalVideoFrames?: number | null;
  connectionState?: string;
  error?: { code?: string; message?: string } | null;
}

describe('Live Streaming media fan-out (real browser e2e)', () => {
  let app: INestApplication;
  let harnessServer: Server;
  let harnessUrl: string;
  let signalingEndpoint: string;
  let browser: Browser;
  let apiKey: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    if (!existsSync(join(HARNESS_DIR, 'vendor', 'raven-client.js'))) {
      // Staged from packages/*/dist rather than committed, so a run can
      // never measure a stale SDK. See scripts/capacity/README.md.
      const { stageHarnessSdk } = await import(join(HARNESS_DIR, '..', 'build-harness-sdk.mjs'));
      stageHarnessSdk({ rebuild: false });
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
      .send({ email: `ls-media-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .send({ name: `ls-media-${suffix}` })
      .expect(201);
    apiKey = (
      await request(app.getHttpServer())
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${registered.body.accessToken}`)
        .send({ name: 'media-e2e' })
        .expect(201)
    ).body.key;

    ({ server: harnessServer, url: harnessUrl } = await startHarnessServer());

    browser = await chromium.launch({
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => harnessServer?.close(() => resolve()));
    await app?.close();
  });

  it(`${VIEWERS} viewers subscribed to one host are all decoding frames, and keep decoding them`, async () => {
    const stream = (
      await request(app.getHttpServer())
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: `Media fan-out ${suffix}`, hostIdentity: 'host' })
        .expect(201)
    ).body;

    const hostCredential = (
      await request(app.getHttpServer())
        .post(`/v1/live-streams/${stream.id}/hosts`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ identity: 'host', role: 'HOST' })
        .expect(201)
    ).body;
    // Same reason as the viewers below: this suite is about the media
    // path, and a chat socket pointed at the wrong host (its apiUrl is
    // derived from API_PUBLIC_URL, same problem as rtc.endpoint) would
    // make a media failure look like a chat failure.
    delete hostCredential.chat;

    await request(app.getHttpServer())
      .post(`/v1/live-streams/${stream.id}/start`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);

    let hostCtx: BrowserContext | undefined;
    let viewerCtx: BrowserContext | undefined;
    try {
      hostCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const hostPage = await hostCtx.newPage();
      const hostConsole: string[] = [];
      hostPage.on('console', (msg) => hostConsole.push(msg.text()));
      hostPage.on('pageerror', (err) => hostConsole.push(`PAGEERROR ${err.stack ?? err.message}`));
      const hostParams = new URLSearchParams({
        credentials: encodeURIComponent(
          JSON.stringify({
            streamId: stream.id,
            ...hostCredential,
            rtc: { ...hostCredential.rtc, endpoint: signalingEndpoint },
            chatRootMessageId: stream.chatRootMessageId,
          }),
        ),
        profile: '360p',
        audio: 'true',
      });
      await hostPage.goto(`${harnessUrl}/host.html?${hostParams}`);
      try {
        await hostPage.waitForFunction(
          () => (window as never as { __state?: { ready?: boolean; error?: unknown } }).__state?.ready === true,
          undefined,
          {
            timeout: 90_000,
          },
        );
      } catch (err) {
        throw new Error(
          `host never became ready: ${(err as Error).message}\n--- host console ---\n${hostConsole.slice(-40).join('\n')}`,
        );
      }

      const seats = [];
      for (let i = 0; i < VIEWERS; i += 1) {
        const identity = `viewer-${i}`;
        const credential = (
          await request(app.getHttpServer())
            .post(`/v1/live-streams/${stream.id}/viewer-tokens`)
            .set('Authorization', `Bearer ${apiKey}`)
            .send({ identity })
            .expect(201)
        ).body;
        // Chat stripped: this suite is about the media path, and a chat
        // socket per viewer would make a media failure look like a chat
        // failure and vice versa.
        delete credential.chat;
        credential.rtc = { ...credential.rtc, endpoint: signalingEndpoint };
        seats.push({ id: identity, credentials: { streamId: stream.id, ...credential } });
      }

      viewerCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const viewerPage: Page = await viewerCtx.newPage();
      const viewerErrors: string[] = [];
      viewerPage.on('pageerror', (err) => viewerErrors.push(err.message));
      await viewerPage.goto(`${harnessUrl}/viewer.html?stagger=100&chat=false`);
      await viewerPage.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true, undefined, {
        timeout: 60_000,
      });
      await viewerPage.evaluate(
        (s) => (window as never as { __setSeats: (x: unknown) => number }).__setSeats(s),
        seats,
      );
      await viewerPage.evaluate(() => (window as never as { __joinAll: () => Promise<void> }).__joinAll());

      await viewerPage.waitForFunction(
        (expected) =>
          (window as never as { __viewers: Map<string, { firstMediaAt: number | null }> }).__viewers &&
          [
            ...(window as never as { __viewers: Map<string, { firstMediaAt: number | null }> }).__viewers.values(),
          ].filter((v) => v.firstMediaAt).length >= expected,
        VIEWERS,
        { timeout: 60_000 },
      );

      // `firstMediaAt` is set on `trackSubscribed`, which fires before the
      // PeerConnection has necessarily produced its first `inbound-rtp`
      // stats entry. Sampling immediately caught two of four viewers with
      // `raw.video` still null — a settle window, not a real failure.
      await new Promise((r) => setTimeout(r, 2_000));

      const sample = () =>
        viewerPage.evaluate(() => (window as never as { __sample: () => Promise<ViewerSample[]> }).__sample());
      const before = (await sample()) as ViewerSample[];
      await new Promise((r) => setTimeout(r, 4_000));
      const after = (await sample()) as ViewerSample[];

      expect(viewerErrors).toEqual([]);

      const beforeById = new Map(before.map((s) => [s.id, s]));
      const verdicts = after.map((now) => {
        const then = beforeById.get(now.id);
        const nowVideo = now.raw?.video;
        const thenVideo = then?.raw?.video;
        return {
          id: now.id,
          connectionState: now.connectionState,
          error: now.error ?? null,
          framesDecodedDelta: nowVideo && thenVideo ? nowVideo.framesDecoded - thenVideo.framesDecoded : null,
          bytesReceivedDelta: nowVideo && thenVideo ? nowVideo.bytesReceived - thenVideo.bytesReceived : null,
          packetsReceivedDelta: nowVideo && thenVideo ? nowVideo.packetsReceived - thenVideo.packetsReceived : null,
          elementFramesDelta:
            typeof now.elementTotalVideoFrames === 'number' && typeof then?.elementTotalVideoFrames === 'number'
              ? now.elementTotalVideoFrames - then.elementTotalVideoFrames
              : null,
        };
      });

      // Reported as one object so a failure names every viewer's actual
      // counters, rather than stopping at the first one.
      expect({ count: verdicts.length, verdicts }).toEqual({
        count: VIEWERS,
        verdicts: verdicts.map((v) => ({
          ...v,
          framesDecodedDelta: expect.any(Number),
          bytesReceivedDelta: expect.any(Number),
          packetsReceivedDelta: expect.any(Number),
          elementFramesDelta: expect.any(Number),
        })),
      });

      for (const verdict of verdicts) {
        expect(verdict).toMatchObject({ error: null });
        expect(verdict.framesDecodedDelta).toBeGreaterThan(0);
        expect(verdict.bytesReceivedDelta).toBeGreaterThan(0);
        expect(verdict.packetsReceivedDelta).toBeGreaterThan(0);
        expect(verdict.elementFramesDelta).toBeGreaterThan(0);
      }

      await request(app.getHttpServer())
        .post(`/v1/live-streams/${stream.id}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
    } finally {
      await viewerCtx?.close();
      await hostCtx?.close();
    }
  });
});
