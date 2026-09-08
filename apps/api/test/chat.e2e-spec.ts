import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * End-to-end test of the Phase 12 chat plane: real WebSocket clients (the
 * `ws` package: indistinguishable from a browser at the protocol level)
 * against the real running app, on the real Postgres and Redis
 * (`docker compose up -d` must be running).
 *
 * Nothing is mocked. Tokens are minted through the real endpoints,
 * messages go through the real gateway into the real database, and
 * fan-out goes through real Redis pub/sub. The two-client tests below are
 * the E2E scenario from spec §54: A sends, B receives, B replies, A
 * receives.
 */
jest.setTimeout(60_000);

describe('Chat (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsBaseUrl: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let jwtToken: string;
  let apiKey: string;
  let projectId: string;
  let room: string;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBaseUrl = `ws://127.0.0.1:${port}/v1/chat/ws`;

    // Both limiters are Redis-backed and IP-keyed, and survive across
    // runs and across suites. Without clearing them, this suite inherits
    // whatever budget the previous suite left behind and fails with 429s
    // that say nothing about the code under test. (Same reset the
    // control-plane and signaling suites do.)
    const redis = app.get(RedisService);
    const stale = [
      ...(await redis.client.keys('ratelimit:*')),
      ...(await redis.client.keys('raven:chat:ratelimit:*')),
    ];
    if (stale.length > 0) await redis.client.del(...stale);

    const registered = await request(baseUrl)
      .post('/v1/auth/register')
      .send({ email: `chat-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    jwtToken = registered.body.accessToken;

    const project = await request(baseUrl)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `chat-e2e-${suffix}` })
      .expect(201);
    projectId = project.body.id;

    const key = await request(baseUrl)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const conversation = await request(baseUrl)
      .post('/v1/chat/conversations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: `e2e-room-${suffix}`,
        members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
      })
      .expect(201);
    room = conversation.body.publicId;

    aliceToken = (await mintToken('alice')).token;
    bobToken = (await mintToken('bob')).token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function mintToken(userId: string, extra: Record<string, unknown> = {}) {
    const response = await request(baseUrl)
      .post('/v1/chat/tokens')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ userId, conversations: [room], ...extra })
      .expect(201);
    return response.body;
  }

  /** A connected test client with a small helper for awaiting specific frames. */
  async function connect(token: string) {
    const socket = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(token)}&sdkVersion=e2e&platform=node`);
    const inbox: Record<string, unknown>[] = [];
    const waiters: Array<{ predicate: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }> = [];

    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      inbox.push(frame);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(frame)) {
          waiters[i].resolve(frame);
          waiters.splice(i, 1);
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    const client = {
      socket,
      inbox,
      send: (frame: Record<string, unknown>) => socket.send(JSON.stringify(frame)),
      waitFor(predicate: (f: Record<string, unknown>) => boolean, timeoutMs = 8000) {
        const existing = inbox.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out; saw frames: ${inbox.map((f) => f.type).join(', ')}`)),
            timeoutMs,
          );
          waiters.push({ predicate, resolve: (f) => { clearTimeout(timer); resolve(f); } });
        });
      },
      close: () => socket.close(),
    };

    await client.waitFor((f) => f.type === 'connected');
    return client;
  }

  async function connectAndJoin(token: string) {
    const client = await connect(token);
    client.send({ type: 'room.join', id: 'join', room });
    await client.waitFor((f) => f.type === 'room.joined');
    return client;
  }

  // -------------------------------------------------------------------------

  describe('authentication', () => {
    it('rejects a connection with no token', async () => {
      const socket = new WebSocket(wsBaseUrl);
      const closeCode = await new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
      expect(closeCode).toBe(4401);
    });

    it('rejects a forged token', async () => {
      const forged = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub: 'mallory', pid: projectId, exp: Math.floor(Date.now() / 1000) + 600, aud: 'raven-chat', iss: 'raven' }),
      ).toString('base64url')}.forged`;

      const socket = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(forged)}`);
      const closeCode = await new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
      expect(closeCode).toBe(4401);
    });

    it('rejects an RTC token — the two planes do not share credentials', async () => {
      const roomRes = await request(baseUrl)
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `rtc-${suffix}` })
        .expect(201);
      const rtc = await request(baseUrl)
        .post(`/v1/rooms/${roomRes.body.id}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'alice' })
        .expect(201);

      const socket = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(rtc.body.token)}`);
      const closeCode = await new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
      expect(closeCode).toBe(4401);
    });

    it('accepts a real chat token and returns a connection id', async () => {
      const client = await connect(aliceToken);
      const hello = client.inbox.find((f) => f.type === 'connected')!;
      expect(hello.connectionId).toMatch(/^ccn_/);
      expect(hello.userId).toBe('alice');
      expect(hello.expiresAt).toBeDefined();
      client.close();
    });
  });

  describe('two clients', () => {
    let alice: Awaited<ReturnType<typeof connectAndJoin>>;
    let bob: Awaited<ReturnType<typeof connectAndJoin>>;

    beforeAll(async () => {
      alice = await connectAndJoin(aliceToken);
      bob = await connectAndJoin(bobToken);
    });

    afterAll(() => {
      alice?.close();
      bob?.close();
    });

    it('delivers a message from A to B, and B\'s reply back to A', async () => {
      alice.send({ type: 'message.send', id: 'a1', room, text: 'Hello from Alice', clientMessageId: `a1-${suffix}` });
      const ack = await alice.waitFor((f) => f.type === 'ack' && f.id === 'a1');
      const first = (ack.data as { message: { id: string } }).message;
      expect(first.id).toMatch(/^msg_/);

      const received = await bob.waitFor((f) => f.type === 'message' && (f.message as { id: string }).id === first.id);
      expect((received.message as { text: string; senderId: string }).text).toBe('Hello from Alice');
      expect((received.message as { senderId: string }).senderId).toBe('alice');

      bob.send({ type: 'message.send', id: 'b1', room, text: 'Hello from Bob', replyTo: first.id });
      const bobAck = await bob.waitFor((f) => f.type === 'ack' && f.id === 'b1');
      const reply = (bobAck.data as { message: { id: string; replyTo: string; threadRootId: string } }).message;
      expect(reply.replyTo).toBe(first.id);
      expect(reply.threadRootId).toBe(first.id);

      const backToAlice = await alice.waitFor((f) => f.type === 'message' && (f.message as { id: string }).id === reply.id);
      expect((backToAlice.message as { text: string }).text).toBe('Hello from Bob');
    });

    it('reports the message as stored only after it is durably in Postgres', async () => {
      alice.send({ type: 'message.send', id: 'a2', room, text: 'Durable' });
      const ack = await alice.waitFor((f) => f.type === 'ack' && f.id === 'a2');
      const data = ack.data as { status: string; message: { id: string } };
      expect(data.status).toBe('stored');

      // The ack claimed durability: prove it by reading the row back
      // through a completely separate HTTP request.
      const fetched = await request(baseUrl)
        .get(`/v1/chat/messages/${data.message.id}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(fetched.body.text).toBe('Durable');
    });

    it('deduplicates a retried send instead of creating a second message', async () => {
      const clientMessageId = `idem-${suffix}`;
      alice.send({ type: 'message.send', id: 'i1', room, text: 'Only once', clientMessageId });
      const first = await alice.waitFor((f) => f.type === 'ack' && f.id === 'i1');

      alice.send({ type: 'message.send', id: 'i2', room, text: 'Only once', clientMessageId });
      const retry = await alice.waitFor((f) => f.type === 'ack' && f.id === 'i2');

      const firstData = first.data as { message: { id: string } };
      const retryData = retry.data as { message: { id: string }; deduplicated: boolean };
      expect(retryData.deduplicated).toBe(true);
      expect(retryData.message.id).toBe(firstData.message.id);
    });

    it('propagates typing without echoing it back to the typist', async () => {
      alice.send({ type: 'typing.start', room });
      const started = await bob.waitFor((f) => f.type === 'typing.started' && f.userId === 'alice');
      expect(started.roomId).toBe(room);
      expect(alice.inbox.some((f) => f.type === 'typing.started' && f.userId === 'alice')).toBe(false);

      alice.send({ type: 'typing.stop', room });
      await bob.waitFor((f) => f.type === 'typing.stopped' && f.userId === 'alice');
    });

    it('propagates reactions and keeps them idempotent per user', async () => {
      alice.send({ type: 'message.send', id: 'r0', room, text: 'React to me' });
      const ack = await alice.waitFor((f) => f.type === 'ack' && f.id === 'r0');
      const messageId = (ack.data as { message: { id: string } }).message.id;

      bob.send({ type: 'reaction.add', id: 'r1', messageId, emoji: '👍' });
      await bob.waitFor((f) => f.type === 'ack' && f.id === 'r1');
      const seen = await alice.waitFor((f) => f.type === 'reaction.added' && f.messageId === messageId);
      expect(seen.emoji).toBe('👍');

      bob.send({ type: 'reaction.add', id: 'r2', messageId, emoji: '👍' });
      const second = await bob.waitFor((f) => f.type === 'ack' && f.id === 'r2');
      expect((second.data as { reactions: Array<{ count: number }> }).reactions[0].count).toBe(1);
    });

    it('propagates edits and deletions, keeping a tombstone', async () => {
      alice.send({ type: 'message.send', id: 'e0', room, text: 'Original' });
      const ack = await alice.waitFor((f) => f.type === 'ack' && f.id === 'e0');
      const messageId = (ack.data as { message: { id: string } }).message.id;

      alice.send({ type: 'message.update', id: 'e1', messageId, text: 'Updated message' });
      await alice.waitFor((f) => f.type === 'ack' && f.id === 'e1');
      const edited = await bob.waitFor((f) => f.type === 'message.updated' && (f.message as { id: string }).id === messageId);
      expect((edited.message as { text: string; edited: boolean }).text).toBe('Updated message');
      expect((edited.message as { edited: boolean }).edited).toBe(true);

      alice.send({ type: 'message.delete', id: 'e2', messageId });
      await alice.waitFor((f) => f.type === 'ack' && f.id === 'e2');
      const deleted = await bob.waitFor((f) => f.type === 'message.deleted' && f.messageId === messageId);
      expect(deleted.deletedAt).toBeDefined();

      // Soft delete: the row survives without its body.
      const fetched = await request(baseUrl)
        .get(`/v1/chat/messages/${messageId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(fetched.body.deleted).toBe(true);
      expect(fetched.body.text).toBeNull();
    });

    it('propagates read receipts', async () => {
      alice.send({ type: 'message.send', id: 'rd0', room, text: 'Read me' });
      const ack = await alice.waitFor((f) => f.type === 'ack' && f.id === 'rd0');
      const messageId = (ack.data as { message: { id: string } }).message.id;

      bob.send({ type: 'read.mark', id: 'rd1', messageId });
      const readAck = await bob.waitFor((f) => f.type === 'ack' && f.id === 'rd1');
      expect((readAck.data as { lastReadMessageId: string }).lastReadMessageId).toBe(messageId);

      const seen = await alice.waitFor((f) => f.type === 'read' && f.userId === 'bob');
      expect(seen.messageId).toBe(messageId);
    });

    it('reports presence for both participants', async () => {
      const presence = await request(baseUrl)
        .get(`/v1/chat/conversations/${room}/presence`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);

      const userIds = (presence.body as Array<{ userId: string }>).map((entry) => entry.userId).sort();
      expect(userIds).toEqual(['alice', 'bob']);
    });
  });

  describe('offline delivery', () => {
    it('gives a reconnecting client the messages it missed', async () => {
      const alice = await connectAndJoin(aliceToken);

      // Bob is not connected at all here.
      alice.send({ type: 'message.send', id: 'off1', room, text: `Sent while offline ${suffix}` });
      await alice.waitFor((f) => f.type === 'ack' && f.id === 'off1');
      alice.close();

      // The WebSocket is not the source of truth: history is.
      const history = await request(baseUrl)
        .get(`/v1/chat/conversations/${room}/messages?limit=1`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);

      expect(history.body.data[0].text).toBe(`Sent while offline ${suffix}`);
    });
  });

  describe('authorization', () => {
    it('refuses to subscribe a non-member', async () => {
      const outsider = await mintToken('mallory', { conversations: [] });
      const client = await connect(outsider.token);

      client.send({ type: 'room.join', id: 'hack', room });
      const error = await client.waitFor((f) => f.type === 'error');
      expect(error.code).toBe('NOT_A_MEMBER');
      client.close();
    });

    it('refuses to read a conversation a non-member is not in', async () => {
      const outsider = await mintToken('mallory', { conversations: [] });
      await request(baseUrl)
        .get(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('ignores a client-supplied senderId', async () => {
      const response = await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ text: 'Who sent this?', senderId: 'bob' })
        .expect(201);

      expect(response.body.senderId).toBe('alice');
    });

    it('refuses to let a browser token mint another token', async () => {
      await request(baseUrl)
        .post('/v1/chat/tokens')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ userId: 'mallory' })
        .expect(403);
    });

    it('refuses to let a member edit someone else\'s message', async () => {
      const posted = await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ text: 'Mine' })
        .expect(201);

      await request(baseUrl)
        .patch(`/v1/chat/messages/${posted.body.id}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ text: 'Not yours' })
        .expect(403);
    });

    it('keeps a read-only token read-only', async () => {
      const readOnly = await mintToken('alice', { scopes: ['chat:read'] });

      await request(baseUrl)
        .get(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${readOnly.token}`)
        .expect(200);

      await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${readOnly.token}`)
        .send({ text: 'should be blocked' })
        .expect(403);
    });
  });

  describe('history pagination', () => {
    let paginationRoom: string;

    beforeAll(async () => {
      const conversation = await request(baseUrl)
        .post('/v1/chat/conversations')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `paging-${suffix}`, members: [{ userId: 'alice', role: 'ADMIN' }] })
        .expect(201);
      paginationRoom = conversation.body.publicId;

      // Seeded under its own sender id, and with that sender's rate-limit
      // budget cleared first. The limiter is per-user and Redis-backed, so
      // reusing 'alice' here would collide with the sends the tests above
      // already made: this seeds history without weakening a real limit.
      const redis = app.get(RedisService);
      const limiterKeys = await redis.client.keys('raven:chat:ratelimit:send:*');
      if (limiterKeys.length > 0) await redis.client.del(...limiterKeys);

      for (let i = 0; i < 25; i++) {
        await request(baseUrl)
          .post(`/v1/chat/conversations/${paginationRoom}/messages`)
          .set('Authorization', `Bearer ${apiKey}`)
          .send({ text: `page-${i}`, senderId: `pager-${i % 5}` })
          .expect(201);
      }
    });

    it('walks the whole history without gaps or duplicates', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 10; page++) {
        const query: string = cursor ? `?limit=10&before=${encodeURIComponent(cursor)}` : '?limit=10';
        const response = await request(baseUrl)
          .get(`/v1/chat/conversations/${paginationRoom}/messages${query}`)
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);

        seen.push(...response.body.data.map((message: { text: string }) => message.text));
        cursor = response.body.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      // Newest first, all the way down.
      expect(seen[0]).toBe('page-24');
      expect(seen[24]).toBe('page-0');
    });

    it('rejects a malformed cursor rather than silently returning page one', async () => {
      const response = await request(baseUrl)
        .get(`/v1/chat/conversations/${paginationRoom}/messages?before=nonsense-cursor`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(400);
      expect(response.body.code).toBe('RAVEN_INVALID_CURSOR');
      // The pre-prefix code ships alongside it, so a client that has not
      // migrated yet still sees what it always saw.
      expect(response.body.legacyCode).toBe('INVALID_CURSOR');
    });
  });

  describe('limits', () => {
    it('rejects an oversized message with a structured error', async () => {
      const response = await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ text: 'x'.repeat(50_000) })
        .expect(413);
      expect(response.body.code).toBe('RAVEN_MESSAGE_TOO_LARGE');
      expect(response.body.legacyCode).toBe('MESSAGE_TOO_LARGE');
    });

    it('refuses a system message from a browser token', async () => {
      await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ text: 'fake announcement', type: 'system' })
        .expect(403);
    });

    it('allows a system message from an API key', async () => {
      const response = await request(baseUrl)
        .post(`/v1/chat/conversations/${room}/messages`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ text: 'Maintenance in 5 minutes', type: 'system', senderId: 'system' })
        .expect(201);
      expect(response.body.type).toBe('system');
    });
  });

  describe('gateway robustness', () => {
    it('survives a malformed frame without dropping the connection', async () => {
      const client = await connectAndJoin(aliceToken);

      client.socket.send('this is not json');
      const error = await client.waitFor((f) => f.type === 'error');
      expect(error.code).toBe('INVALID_MESSAGE');

      // Still usable afterwards: one bad frame must not kill the session.
      client.send({ type: 'ping', id: 'p1' });
      await client.waitFor((f) => f.type === 'pong');
      client.close();
    });

    it('rejects an unknown frame type by name', async () => {
      const client = await connectAndJoin(aliceToken);
      client.send({ type: 'message.nuke', id: 'x' });
      const error = await client.waitFor((f) => f.type === 'error');
      expect(error.code).toBe('INVALID_MESSAGE_TYPE');
      client.close();
    });

    it('refuses to leave a room it never joined', async () => {
      const client = await connect(aliceToken);
      client.send({ type: 'room.leave', id: 'l1', room });
      const error = await client.waitFor((f) => f.type === 'error');
      expect(error.code).toBe('NOT_IN_ROOM');
      client.close();
    });

    it('clears presence when a socket disconnects', async () => {
      const conversation = await request(baseUrl)
        .post('/v1/chat/conversations')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `presence-${suffix}`, members: [{ userId: 'alice', role: 'ADMIN' }] })
        .expect(201);
      const presenceRoom = conversation.body.publicId;

      const token = await mintToken('alice', { conversations: [presenceRoom] });
      const socket = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(token.token)}`);
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      socket.send(JSON.stringify({ type: 'room.join', id: 'j', room: presenceRoom }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const before = await request(baseUrl)
        .get(`/v1/chat/conversations/${presenceRoom}/presence`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(before.body).toHaveLength(1);

      socket.close();
      await new Promise((resolve) => setTimeout(resolve, 800));

      const after = await request(baseUrl)
        .get(`/v1/chat/conversations/${presenceRoom}/presence`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(after.body).toHaveLength(0);
    });
  });

  describe('RTC coexistence', () => {
    it('attaches a conversation to an RTC room and resolves it either way', async () => {
      const rtcRoom = await request(baseUrl)
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `combined-${suffix}` })
        .expect(201);

      const conversation = await request(baseUrl)
        .post('/v1/chat/conversations')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `combined-chat-${suffix}`, roomId: rtcRoom.body.id })
        .expect(201);

      expect(conversation.body.type).toBe('ROOM');

      // Resolvable by the RTC room's id: that's what lets a developer
      // hand both SDKs the same identifier.
      const byRoomId = await request(baseUrl)
        .get(`/v1/chat/conversations/${rtcRoom.body.id}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(byRoomId.body.publicId).toBe(conversation.body.publicId);
    });

    it('leaves RTC token minting completely unaffected', async () => {
      const rtcRoom = await request(baseUrl)
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `rtc-still-works-${suffix}` })
        .expect(201);

      const token = await request(baseUrl)
        .post(`/v1/rooms/${rtcRoom.body.id}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'alice' })
        .expect(201);

      expect(token.body.token).toBeDefined();
      expect(token.body.endpoint).toBeDefined();
      expect(token.body.iceServers.length).toBeGreaterThan(0);
    });
  });
});
