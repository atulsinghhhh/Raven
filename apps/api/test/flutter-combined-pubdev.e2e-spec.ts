import { createReadStream, existsSync } from 'fs';
import { createServer, type Server } from 'http';
import { extname, join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { corsOriginFor, parseCorsAllowlist } from '../src/shared/config/cors-policy';
import { RedisService } from '../src/shared/redis/redis.service';
import { registerLocalSfu } from './helpers/register-local-sfu';

/**
 * Section 9 of the pub.dev consumer validation: one Flutter app
 * (`main_combined.dart`) that imports `raven_rtc`, `raven_live` *and*
 * `raven_chat` together from pub.dev, and drives a real flow through
 * each in the same isolate. `main_combined.dart` already proved there is
 * no *compile-time* conflict (all three resolve and build together); this
 * proves there is no *runtime* one either — both a live-stream join
 * (host, camera+mic) and a chat connect+send actually complete
 * concurrently in the same page.
 */
jest.setTimeout(120_000);

const COMBINED_APP_WEB_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'flutter_check',
  'published_consumer',
  'build',
  'web_combined',
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

type State = Record<string, unknown>;

async function waitFor(
  page: import('playwright').Page,
  predicate: (arg: any) => boolean,
  description: string,
  timeoutMs = 30_000,
  arg?: unknown,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate as (arg: unknown) => boolean, arg)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const state = await page.evaluate(() => (window as unknown as { __state?: State }).__state ?? {});
  throw new Error(`Timed out waiting for ${description}. Last __state: ${JSON.stringify(state)}`);
}

describe('raven_rtc + raven_live + raven_chat together (published pub.dev packages) — combined runtime (real E2E)', () => {
  let app: INestApplication;
  let server: Server;
  let urlBase: string;
  let apiBaseUrl: string;
  let signalingEndpoint: string;
  let browser: Browser;
  let apiKey: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    if (!existsSync(join(COMBINED_APP_WEB_DIR, 'index.html'))) {
      throw new Error(
        `No Flutter web build at ${COMBINED_APP_WEB_DIR}.\n` +
          'Run: (cd flutter_check/published_consumer && flutter build web --release ' +
          '-t lib/main_combined.dart -o build/web_combined)',
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    const configService = app.get(ConfigService);
    const allowlist = parseCorsAllowlist(configService.get<string>('cors.origin')!);
    app.enableCors((req: { url?: string }, callback: (err: Error | null, options: CorsOptions) => void) => {
      callback(null, { origin: corsOriginFor(req.url, allowlist) });
    });
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    apiBaseUrl = `http://127.0.0.1:${port}`;
    signalingEndpoint = `ws://127.0.0.1:${port}/v1/rtc`;

    const redis = app.get(RedisService);
    const stale = [
      ...(await redis.client.keys('ratelimit:*')),
      ...(await redis.client.keys('raven:chat:ratelimit:*')),
    ];
    if (stale.length > 0) await redis.client.del(...stale);

    await registerLocalSfu(app);

    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `flutter-combined-pubdev-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `flutter-combined-pubdev-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const staticFiles = await startStaticServer(COMBINED_APP_WEB_DIR, 'index.html');
    server = staticFiles.server;
    urlBase = staticFiles.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

  it('one Flutter app runs a real chat connection and a real live-stream host join at the same time', async () => {
    // --- chat side ---
    const conversation = await request(app.getHttpServer())
      .post('/v1/chat/conversations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: `combined-e2e-${suffix}`, members: [{ userId: 'combined-user', role: 'ADMIN' }] })
      .expect(201);
    const chatRoom = conversation.body.publicId;
    const chatTokenRes = await request(app.getHttpServer())
      .post('/v1/chat/tokens')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ userId: 'combined-user', conversations: [chatRoom] })
      .expect(201);

    // --- live side ---
    const streamRes = await request(app.getHttpServer())
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: `Combined E2E ${suffix}`, hostIdentity: 'combined-host' })
      .expect(201);
    const streamId = streamRes.body.id;
    await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/start`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);
    const hostCredsRes = await request(app.getHttpServer())
      .post(`/v1/live-streams/${streamId}/hosts`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity: 'combined-host', role: 'HOST' })
      .expect(201);
    const hostCreds = { ...hostCredsRes.body, rtc: { ...hostCredsRes.body.rtc, endpoint: signalingEndpoint } };

    let ctx: BrowserContext | undefined;
    try {
      ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const page = await ctx.newPage();
      page.on('console', (m) => console.log('[combined console]', m.text()));

      const params = new URLSearchParams({
        creds: JSON.stringify(hostCreds),
        chatToken: chatTokenRes.body.token,
        chatApiUrl: apiBaseUrl,
        chatRoom: chatRoom,
      });
      await page.goto(`${urlBase}/index.html?${params.toString()}`);

      await waitFor(
        page,
        () => (window as unknown as { __state?: { chat?: { ready?: boolean } } }).__state?.chat?.ready === true,
        'the chat side of the combined app to report ready',
        60_000,
      );
      await waitFor(
        page,
        () => (window as unknown as { __state?: { live?: { ready?: boolean } } }).__state?.live?.ready === true,
        'the live-stream side of the combined app to report ready',
        60_000,
      );

      const state = await page.evaluate(() => (window as unknown as { __state: State }).__state);
      console.log('[test] combined app state once both sides are ready:', JSON.stringify(state));

      expect((state.chat as State).connectionState).toBe('connected');
      expect((state.live as State).connectionState).toBe('connected');
      expect((state.live as State).cameraPublished).toBe(true);
      expect((state.live as State).microphonePublished).toBe(true);
      expect(state.importedPackages).toEqual(['raven_rtc', 'raven_live', 'raven_chat']);

      // Prove the chat side is genuinely live, not just "connected": send
      // a real message through it while the live-stream side is also up.
      await page.evaluate(
        (msg) => (window as unknown as { __doChatSend: (m: string) => void }).__doChatSend(msg),
        'hello from the combined app',
      );
      await waitFor(
        page,
        () =>
          (window as unknown as { __state?: { chat?: { lastSent?: { text?: string } } } }).__state?.chat?.lastSent
            ?.text === 'hello from the combined app',
        'the chat send issued from the combined app to complete',
      );

      console.log('[test] raven_rtc + raven_live + raven_chat ran together in one app with no conflicts');
    } finally {
      await ctx?.close();
      await request(app.getHttpServer())
        .post(`/v1/live-streams/${streamId}/end`)
        .set('Authorization', `Bearer ${apiKey}`);
    }
  });
});
