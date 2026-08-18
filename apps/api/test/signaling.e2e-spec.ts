import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { AccessToken } from 'livekit-server-sdk';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * End-to-end test of the Phase 3 signaling layer: real WebSocket clients
 * (the `ws` package, exactly like a browser's native WebSocket from the
 * protocol's point of view) against the real running app, backed by the
 * real Phase 1 Postgres/Redis (`docker compose up -d` must be running).
 * RTC tokens are minted through the real Phase 2 HTTP control-plane
 * endpoints, not hand-constructed, except where a test explicitly needs
 * an already-expired or wrong-secret token (see the "authentication"
 * describe block).
 */
describe('Signaling (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsBaseUrl: string;
  let configService: ConfigService;
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2);

  let jwtToken: string;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBaseUrl = `ws://127.0.0.1:${port}/v1/rtc`;
    configService = app.get(ConfigService);

    const redis = app.get(RedisService);
    const staleKeys = await redis.client.keys('ratelimit:*');
    if (staleKeys.length > 0) {
      await redis.client.del(...staleKeys);
    }

    const email = `signaling-e2e-${uniqueSuffix}@raven.local`;
    const registerRes = await request(baseUrl)
      .post('/v1/auth/register')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    jwtToken = registerRes.body.accessToken;

    const projectRes = await request(baseUrl)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'Signaling E2E' })
      .expect(201);

    const keyRes = await request(baseUrl)
      .post(`/v1/projects/${projectRes.body.id}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({})
      .expect(201);
    apiKey = keyRes.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Creates a fresh room and mints an RTC token for it via the real HTTP API. */
  async function mintToken(
    roomName: string,
    participantIdentity: string,
    permissions: Record<string, boolean> = { join: true, subscribe: true, publish: true },
  ): Promise<{ token: string; roomId: string }> {
    const roomRes = await request(baseUrl)
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: `${roomName}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .expect(201);

    const tokenRes = await request(baseUrl)
      .post(`/v1/rooms/${roomRes.body.id}/rtc-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ participantIdentity, permissions })
      .expect(201);

    return { token: tokenRes.body.token, roomId: roomRes.body.id };
  }

  /** A thin promise-based wrapper around `ws` for readable test bodies. */
  class TestClient {
    private readonly received: unknown[] = [];
    private readonly waiters: Array<{
      predicate: (msg: any) => boolean;
      resolve: (msg: any) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];
    readonly socket: WebSocket;
    closeCode: number | null = null;
    closeReason = '';

    constructor(token: string) {
      this.socket = new WebSocket(`${wsBaseUrl}?token=${encodeURIComponent(token)}`);
      this.socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        this.received.push(msg);
        const waiterIndex = this.waiters.findIndex((w) => w.predicate(msg));
        if (waiterIndex >= 0) {
          const [waiter] = this.waiters.splice(waiterIndex, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
        }
      });
      this.socket.on('close', (code, reason) => {
        this.closeCode = code;
        this.closeReason = reason.toString();
      });
    }

    waitForOpen(): Promise<void> {
      return new Promise((resolve, reject) => {
        this.socket.once('open', () => resolve());
        this.socket.once('error', reject);
      });
    }

    waitForClose(timeoutMs = 2000): Promise<{ code: number; reason: string }> {
      return new Promise((resolve, reject) => {
        if (this.closeCode !== null) {
          resolve({ code: this.closeCode, reason: this.closeReason });
          return;
        }
        const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
        this.socket.once('close', (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason.toString() });
        });
      });
    }

    waitFor(predicate: (msg: any) => boolean, timeoutMs = 2000): Promise<any> {
      const already = this.received.find(predicate);
      if (already) {
        return Promise.resolve(already);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for message matching predicate`)),
          timeoutMs,
        );
        this.waiters.push({ predicate, resolve, reject, timer });
      });
    }

    waitForType(type: string, timeoutMs = 2000): Promise<any> {
      return this.waitFor((msg) => msg.type === type, timeoutMs);
    }

    send(message: Record<string, unknown>): void {
      this.socket.send(JSON.stringify(message));
    }

    close(): void {
      this.socket.close();
    }
  }

  describe('authentication', () => {
    it('accepts a connection with a valid RTC token', async () => {
      const { token } = await mintToken('auth-room', 'alice');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join' });
      const joined = await client.waitForType('room.joined');
      expect(joined.roomId).toBeDefined();
      client.close();
    });

    it('rejects a malformed token and closes the connection', async () => {
      const client = new TestClient('not-a-real-token');
      await client.waitForOpen();
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_TOKEN');
      const closeInfo = await client.waitForClose();
      expect(closeInfo.code).toBe(4001);
    });

    it('rejects an expired token', async () => {
      const apiKeyLk = configService.get<string>('livekit.apiKey')!;
      const apiSecretLk = configService.get<string>('livekit.apiSecret')!;
      const { roomId } = await mintToken('expiry-room', 'zack');

      const at = new AccessToken(apiKeyLk, apiSecretLk, {
        identity: 'zack',
        ttl: -10, // already expired
        attributes: { ravenProjectId: 'whatever-project', ravenRoomId: roomId },
      });
      at.addGrant({ room: 'expiry-room', roomJoin: true, canSubscribe: true });
      const expiredToken = await at.toJwt();

      const client = new TestClient(expiredToken);
      await client.waitForOpen();
      const error = await client.waitForType('error');
      expect(error.code).toBe('TOKEN_EXPIRED');
      const closeInfo = await client.waitForClose();
      expect(closeInfo.code).toBe(4001);
    });

    it('rejects room.join when the message roomId disagrees with the token-bound room', async () => {
      const { token } = await mintToken('room-a', 'dave');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', roomId: 'some-other-room-id' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('UNAUTHORIZED');
      client.close();
    });
  });

  describe('permissions', () => {
    it('rejects room.join without join permission', async () => {
      const { token } = await mintToken('perm-room', 'no-join-guy', {
        join: false,
        subscribe: true,
        publish: false,
      });
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PERMISSION_DENIED');
      client.close();
    });

    it('accepts room.join with join permission', async () => {
      const { token } = await mintToken('perm-room-ok', 'join-guy', { join: true, subscribe: true });
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join' });
      const joined = await client.waitForType('room.joined');
      expect(joined.participants).toEqual([]);
      client.close();
    });
  });

  describe('validation', () => {
    let token: string;
    beforeAll(async () => {
      ({ token } = await mintToken('validation-room', 'validator'));
    });

    it('rejects invalid JSON', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.socket.send('{not valid json');
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });

    it('rejects an unknown message type', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'totally.made.up' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE_TYPE');
      client.close();
    });

    it('rejects a message missing required fields', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'sdp.offer' }); // missing targetParticipantId + sdp
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });

    it('rejects an oversized message', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      const maxBytes = configService.get<number>('signaling.maxMessageBytes')!;
      client.send({ type: 'sdp.offer', targetParticipantId: 'x', sdp: 'a'.repeat(maxBytes + 1000) });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });
  });

  describe('the full two-participant integration flow (Phase 3 §23)', () => {
    it('walks connect -> join -> events -> sdp -> ice -> disconnect for two participants', async () => {
      const { token: tokenA, roomId } = await mintToken('integration-room', 'participant-a');
      const roomRes = await request(baseUrl)
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'participant-b', permissions: { join: true, subscribe: true, publish: true } })
        .expect(201);
      const tokenB = roomRes.body.token;

      // 1. A connects. 2. B connects.
      const clientA = new TestClient(tokenA);
      const clientB = new TestClient(tokenB);
      await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);

      // 3. A joins room.
      clientA.send({ type: 'room.join' });
      const aJoined = await clientA.waitForType('room.joined');
      expect(aJoined.participants).toEqual([]);

      // 4. B joins room. 6. B receives A joined event (A was already there).
      clientB.send({ type: 'room.join' });
      const bJoined = await clientB.waitForType('room.joined');
      expect(bJoined.participants).toEqual([{ id: 'participant-a' }]);

      // 5. A receives B joined event.
      const aSeesBJoin = await clientA.waitForType('participant.joined');
      expect(aSeesBJoin.participant).toEqual({ id: 'participant-b' });

      // 7. A sends SDP offer. 8. B receives offer.
      clientA.send({ type: 'sdp.offer', targetParticipantId: 'participant-b', sdp: 'v=0 offer-sdp' });
      const offerAtB = await clientB.waitForType('sdp.offer');
      expect(offerAtB).toEqual({ type: 'sdp.offer', fromParticipantId: 'participant-a', sdp: 'v=0 offer-sdp' });

      // 9. B sends SDP answer. 10. A receives answer.
      clientB.send({ type: 'sdp.answer', targetParticipantId: 'participant-a', sdp: 'v=0 answer-sdp' });
      const answerAtA = await clientA.waitForType('sdp.answer');
      expect(answerAtA).toEqual({ type: 'sdp.answer', fromParticipantId: 'participant-b', sdp: 'v=0 answer-sdp' });

      // 11. ICE candidates are exchanged (both directions).
      const candidate = { candidate: 'candidate:1 1 UDP 2130706431 10.0.0.1 54400 typ host', sdpMid: '0' };
      clientA.send({ type: 'ice.candidate', targetParticipantId: 'participant-b', candidate });
      const iceAtB = await clientB.waitForType('ice.candidate');
      expect(iceAtB).toEqual({ type: 'ice.candidate', fromParticipantId: 'participant-a', candidate });

      clientB.send({ type: 'ice.candidate', targetParticipantId: 'participant-a', candidate });
      const iceAtA = await clientA.waitForType('ice.candidate');
      expect(iceAtA).toEqual({ type: 'ice.candidate', fromParticipantId: 'participant-b', candidate });

      // 12. A disconnects. 13. B receives participant.left.
      clientA.close();
      const bSeesALeave = await clientB.waitForType('participant.left');
      expect(bSeesALeave.participant).toEqual({ id: 'participant-a' });

      clientB.close();
    });
  });

  describe('sdp/ice authorization', () => {
    it('rejects an sdp offer targeting a participant not in the room', async () => {
      const { token } = await mintToken('lonely-room', 'solo');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join' });
      await client.waitForType('room.joined');

      client.send({ type: 'sdp.offer', targetParticipantId: 'nobody-here', sdp: 'v=0' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PARTICIPANT_NOT_FOUND');
      client.close();
    });

    it('cannot reach a participant identity that only exists in a different room', async () => {
      const { token: tokenRoom1 } = await mintToken('cross-room-1', 'carl');
      const { token: tokenRoom2 } = await mintToken('cross-room-2', 'diane');

      const client1 = new TestClient(tokenRoom1);
      const client2 = new TestClient(tokenRoom2);
      await Promise.all([client1.waitForOpen(), client2.waitForOpen()]);
      client1.send({ type: 'room.join' });
      client2.send({ type: 'room.join' });
      await Promise.all([client1.waitForType('room.joined'), client2.waitForType('room.joined')]);

      // carl (room 1) tries to reach diane (room 2) — must not resolve.
      client1.send({ type: 'ice.candidate', targetParticipantId: 'diane', candidate: {} });
      const error = await client1.waitForType('error');
      expect(error.code).toBe('PARTICIPANT_NOT_FOUND');

      client1.close();
      client2.close();
    });
  });

  describe('connection lifecycle', () => {
    it('removes a participant from room state on abrupt disconnect', async () => {
      const { token: tokenA, roomId } = await mintToken('disconnect-room', 'eve');
      const tokenBRes = await request(baseUrl)
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'frank', permissions: { join: true, subscribe: true } })
        .expect(201);

      const clientEve = new TestClient(tokenA);
      const clientFrank = new TestClient(tokenBRes.body.token);
      await Promise.all([clientEve.waitForOpen(), clientFrank.waitForOpen()]);
      clientEve.send({ type: 'room.join' });
      await clientEve.waitForType('room.joined');
      clientFrank.send({ type: 'room.join' });
      await clientFrank.waitForType('room.joined');
      await clientEve.waitForType('participant.joined');

      // Simulate an abrupt disconnect (not a graceful room.leave).
      clientEve.socket.terminate();
      const frankSeesLeave = await clientFrank.waitForType('participant.left');
      expect(frankSeesLeave.participant).toEqual({ id: 'eve' });

      clientFrank.close();
    });

    it('supports reconnection: a new connection for the same identity replaces the old one', async () => {
      const { token } = await mintToken('reconnect-room', 'gina');

      const first = new TestClient(token);
      await first.waitForOpen();
      first.send({ type: 'room.join' });
      await first.waitForType('room.joined');

      // Reconnect: same participant identity, a brand new token/connection.
      const second = new TestClient(token);
      await second.waitForOpen();
      second.send({ type: 'room.join' });
      await second.waitForType('room.joined');

      // The old connection must be told it was replaced and closed.
      const kickError = await first.waitForType('error');
      expect(kickError.code).toBe('UNAUTHORIZED');
      const closeInfo = await first.waitForClose();
      expect(closeInfo.code).toBe(4002);

      second.close();
    });
  });
});
