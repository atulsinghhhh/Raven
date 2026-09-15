import { createReadStream, existsSync } from 'fs';
import { createServer, type Server } from 'http';
import { extname, join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { corsOriginFor, parseCorsAllowlist } from '../src/shared/config/cors-policy';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * Real E2E check of the *published* `raven_chat` package (pub.dev, no
 * path override — see `flutter_check/published_consumer/pubspec.yaml`)
 * against the real chat plane: a real NestJS app, real Postgres, real
 * Redis fan-out, and two real Flutter Web clients (built from
 * `main_chat.dart`) driven by Playwright.
 *
 * Unlike `chat.e2e-spec.ts` (which drives the backend directly with raw
 * `ws` clients), this suite is scoped to whether the *SDK* an external
 * developer actually installs behaves correctly end to end — no harness
 * for this existed before this file (see the final report's "stale
 * consumers" section for why `raven_chat` had no Flutter-level E2E
 * coverage until now).
 */
jest.setTimeout(120_000);

const CHAT_APP_WEB_DIR = join(__dirname, '..', '..', '..', 'flutter_check', 'published_consumer', 'build', 'web_chat');

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

// `predicate` runs inside the page via `page.evaluate`, which serializes
// the function source and re-runs it in the browser — it cannot close
// over Node-side variables (e.g. a message id captured from an earlier
// `page.evaluate` call). Pass anything the predicate needs via `arg`.
async function waitFor(
  page: Page,
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

describe('raven_chat (published pub.dev package) — two real Flutter Web clients (real E2E)', () => {
  let app: INestApplication;
  let server: Server;
  let urlBase: string;
  let apiBaseUrl: string;
  let browser: Browser;
  let apiKey: string;
  let room: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    if (!existsSync(join(CHAT_APP_WEB_DIR, 'index.html'))) {
      throw new Error(
        `No Flutter web build at ${CHAT_APP_WEB_DIR}.\n` +
          'Run: (cd flutter_check/published_consumer && flutter build web --release ' +
          '-t lib/main_chat.dart -o build/web_chat)',
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    // None of this repo's `Test.createTestingModule` e2e suites go through
    // `main.ts`'s `bootstrap()`, so none of them normally get CORS enabled —
    // harmless for the WS-only/supertest suites, but this one is the first
    // to make a genuine browser `fetch()` (raven_chat's REST fallback and
    // `history()`) against the Jest-hosted app, which browsers do subject
    // to CORS. Replicated verbatim from `main.ts` so this suite reflects
    // real deployment behavior instead of failing on a harness gap.
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

    const redis = app.get(RedisService);
    const stale = [...(await redis.client.keys('ratelimit:*')), ...(await redis.client.keys('raven:chat:ratelimit:*'))];
    if (stale.length > 0) await redis.client.del(...stale);

    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `flutter-chat-pubdev-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `flutter-chat-pubdev-e2e-${suffix}` })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const conversation = await request(app.getHttpServer())
      .post('/v1/chat/conversations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: `flutter-e2e-room-${suffix}`,
        members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
      })
      .expect(201);
    room = conversation.body.publicId;

    const staticFiles = await startStaticServer(CHAT_APP_WEB_DIR, 'index.html');
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

  async function mintToken(userId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/tokens')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ userId, conversations: [room] })
      .expect(201);
    return res.body.token;
  }

  function appUrl(token: string): string {
    const params = new URLSearchParams({ token, apiUrl: apiBaseUrl, room });
    return `${urlBase}/index.html?${params.toString()}`;
  }

  it(
    'connect, join, send/receive, typing, presence, reactions, read receipts and edit/delete all cross ' +
      'between two real Flutter clients',
    async () => {
      const aliceToken = await mintToken('alice');
      const bobToken = await mintToken('bob');

      let aliceCtx: BrowserContext | undefined;
      let bobCtx: BrowserContext | undefined;
      try {
        aliceCtx = await browser.newContext();
        bobCtx = await browser.newContext();
        const alicePage = await aliceCtx.newPage();
        const bobPage = await bobCtx.newPage();
        alicePage.on('console', (m) => console.log('[alice console]', m.text()));
        bobPage.on('console', (m) => console.log('[bob console]', m.text()));

        await Promise.all([alicePage.goto(appUrl(aliceToken)), bobPage.goto(appUrl(bobToken))]);

        await waitFor(
          alicePage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          'alice to report ready',
        );
        await waitFor(
          bobPage,
          () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
          'bob to report ready',
        );
        expect(await alicePage.evaluate(() => (window as unknown as { __state: State }).__state.connectionState)).toBe(
          'connected',
        );
        expect(await bobPage.evaluate(() => (window as unknown as { __state: State }).__state.connectionState)).toBe(
          'connected',
        );

        // --- send/receive ---
        await alicePage.evaluate(
          (t) => (window as unknown as { __doSend: (x: string) => void }).__doSend(t),
          'hello bob, this is alice',
        );
        await waitFor(
          bobPage,
          () => {
            const msgs = (window as unknown as { __state?: { messages?: { text?: string }[] } }).__state?.messages;
            return !!msgs?.some((m) => m.text === 'hello bob, this is alice');
          },
          "bob to receive alice's message",
        );

        const bobMessages = await bobPage.evaluate(
          () => (window as unknown as { __state: { messages: { id: string; text: string }[] } }).__state.messages,
        );
        const firstMessageId = bobMessages.find((m) => m.text === 'hello bob, this is alice')!.id;
        console.log('[test] first message id:', firstMessageId);

        await bobPage.evaluate(
          (t) => (window as unknown as { __doSend: (x: string) => void }).__doSend(t),
          'hi alice, bob here',
        );
        await waitFor(
          alicePage,
          () => {
            const msgs = (window as unknown as { __state?: { messages?: { text?: string }[] } }).__state?.messages;
            return !!msgs?.some((m) => m.text === 'hi alice, bob here');
          },
          "alice to receive bob's reply",
        );

        // --- typing ---
        await alicePage.evaluate(() => (window as unknown as { __doStartTyping: () => void }).__doStartTyping());
        await waitFor(
          bobPage,
          () => {
            const events = (
              window as unknown as { __state?: { typingEvents?: { userId?: string; isTyping?: boolean }[] } }
            ).__state?.typingEvents;
            return !!events?.some((e) => e.userId === 'alice' && e.isTyping === true);
          },
          "bob to see alice's typing indicator",
        );

        // --- presence ---
        // 'online' is already each socket's presence as of connect/join
        // (see PresenceService.set: it "broadcasts only on an actual
        // change"), so asking for 'online' again would be a same-state
        // no-op with nothing to observe. 'away' is a real transition.
        await alicePage.evaluate(
          (s) => (window as unknown as { __doSetPresence: (x: string) => void }).__doSetPresence(s),
          'away',
        );
        await waitFor(
          bobPage,
          () => {
            const events = (
              window as unknown as { __state?: { presenceEvents?: { userId?: string; status?: string }[] } }
            ).__state?.presenceEvents;
            return !!events?.some((e) => e.userId === 'alice' && e.status === 'away');
          },
          "bob to see alice's presence update",
        );

        // --- reactions ---
        await bobPage.evaluate(
          ({ id, emoji }) =>
            (window as unknown as { __doAddReaction: (i: string, e: string) => void }).__doAddReaction(id, emoji),
          { id: firstMessageId, emoji: '👍' },
        );
        await waitFor(
          alicePage,
          () => {
            const events = (
              window as unknown as {
                __state?: { reactionEvents?: { userId?: string; emoji?: string; added?: boolean }[] };
              }
            ).__state?.reactionEvents;
            return !!events?.some((e) => e.userId === 'bob' && e.emoji === '👍' && e.added === true);
          },
          "alice to see bob's reaction",
        );

        // --- read receipts ---
        await bobPage.evaluate(
          (id) => (window as unknown as { __doMarkAsRead: (i: string) => void }).__doMarkAsRead(id),
          firstMessageId,
        );
        await waitFor(
          bobPage,
          (id) => (window as unknown as { __state?: { lastMarkedRead?: string } }).__state?.lastMarkedRead === id,
          "bob's markAsRead call to complete",
          30_000,
          firstMessageId,
        );

        // --- edit ---
        await alicePage.evaluate(
          ({ id, text }) => (window as unknown as { __doEdit: (i: string, t: string) => void }).__doEdit(id, text),
          { id: firstMessageId, text: 'hello bob, this is alice (edited)' },
        );
        await waitFor(
          bobPage,
          (id) => {
            const updates = (
              window as unknown as { __state?: { messageUpdates?: { id?: string; text?: string; edited?: boolean }[] } }
            ).__state?.messageUpdates;
            return !!updates?.some((m) => m.id === id && m.edited === true);
          },
          'bob to see the edited message',
          30_000,
          firstMessageId,
        );

        // --- delete ---
        await alicePage.evaluate(
          (id) => (window as unknown as { __doDelete: (i: string) => void }).__doDelete(id),
          firstMessageId,
        );
        await waitFor(
          bobPage,
          (id) => {
            const deletions = (window as unknown as { __state?: { messageDeletions?: { id?: string }[] } }).__state
              ?.messageDeletions;
            return !!deletions?.some((d) => d.id === id);
          },
          'bob to see the message deletion',
          30_000,
          firstMessageId,
        );

        console.log('[test] all raven_chat flows crossed between two real Flutter Web clients successfully');
      } finally {
        await aliceCtx?.close();
        await bobCtx?.close();
      }
    },
  );

  it('history/pagination and the REST fallback (send while the socket is down) both work against the real backend', async () => {
    const aliceToken = await mintToken('alice');

    let aliceCtx: BrowserContext | undefined;
    try {
      aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();
      alicePage.on('console', (m) => console.log('[alice console]', m.text()));
      await alicePage.goto(appUrl(aliceToken));
      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { ready?: boolean } }).__state?.ready === true,
        'alice to report ready',
      );

      for (let i = 0; i < 3; i++) {
        await alicePage.evaluate(
          (t) => (window as unknown as { __doSend: (x: string) => void }).__doSend(t),
          `history-message-${i}`,
        );
      }
      await waitFor(
        alicePage,
        () => ((window as unknown as { __state?: { messages?: unknown[] } }).__state?.messages?.length ?? 0) >= 3,
        'all three messages to be sent',
      );

      // --- history, paged one at a time ---
      await alicePage.evaluate(() => (window as unknown as { __doHistory: (c: string) => void }).__doHistory(''));
      await waitFor(
        alicePage,
        () => !!(window as unknown as { __state?: { lastHistory?: { messages?: unknown[] } } }).__state?.lastHistory,
        'the first history page to arrive',
      );
      const firstPage = await alicePage.evaluate(
        () =>
          (
            window as unknown as {
              __state: { lastHistory: { messages: unknown[]; nextCursor: string | null; hasMore: boolean } };
            }
          ).__state.lastHistory,
      );
      console.log('[test] history page 1:', JSON.stringify(firstPage));
      expect(firstPage.messages.length).toBeGreaterThan(0);

      if (firstPage.hasMore && firstPage.nextCursor) {
        await alicePage.evaluate(
          (cursor) => (window as unknown as { __doHistory: (c: string) => void }).__doHistory(cursor),
          firstPage.nextCursor,
        );
        await waitFor(
          alicePage,
          () =>
            (window as unknown as { __state: { lastHistory: { nextCursor: string | null } } }).__state.lastHistory
              .nextCursor !== firstPage.nextCursor,
          'the second history page to arrive',
        );
        const secondPage = await alicePage.evaluate(
          () => (window as unknown as { __state: { lastHistory: { messages: unknown[] } } }).__state.lastHistory,
        );
        console.log('[test] history page 2 (cursor-paginated):', JSON.stringify(secondPage));
        expect(secondPage.messages.length).toBeGreaterThan(0);
      } else {
        console.log('[test] fewer messages than the default page size — pagination cursor not exercised further');
      }

      // --- REST fallback: disconnect, then send while the socket is down ---
      await alicePage.evaluate(() => (window as unknown as { __doDisconnect: () => void }).__doDisconnect());
      await waitFor(
        alicePage,
        () => (window as unknown as { __state?: { phase?: string } }).__state?.phase === 'disconnected',
        'alice to actually disconnect',
      );

      await alicePage.evaluate(
        (t) => (window as unknown as { __doSend: (x: string) => void }).__doSend(t),
        'sent-via-rest-fallback',
      );
      await waitFor(
        alicePage,
        () => {
          const sent = (window as unknown as { __state?: { lastSent?: { text?: string } } }).__state?.lastSent;
          return sent?.text === 'sent-via-rest-fallback';
        },
        'the REST-fallback send to complete while disconnected',
      );
      console.log('[test] REST fallback confirmed: message sent successfully with the socket down');

      // Confirm it actually landed durably, not just locally-echoed.
      const stored = await request(app.getHttpServer())
        .get(`/v1/chat/conversations/${encodeURIComponent(room)}/messages`)
        .set('Authorization', `Bearer ${apiKey}`)
        .query({ limit: '10' })
        .expect(200);
      // Wire field is `data` (see MessagePage in messages.service.ts); the
      // SDK's own RavenMessagePage.fromJson maps that to its `.messages`,
      // but this is a raw supertest call, not the SDK.
      const found = (stored.body.data as { text: string }[]).some((m) => m.text === 'sent-via-rest-fallback');
      expect(found).toBe(true);
    } finally {
      await aliceCtx?.close();
    }
  });
});
