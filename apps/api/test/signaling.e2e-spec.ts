import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { RtcTokenSignerService } from '../src/modules/rtc-tokens/rtc-token-signer.service';
import { resolvePermissions } from '../src/modules/rtc-tokens/rtc-token.claims';
import { RtcTokenPermissionsDto } from '../src/modules/rtc-tokens/dto/rtc-token-permissions.dto';
import { Environment } from '../src/shared/environment/environment.constants';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { PrismaService } from '../src/shared/database/prisma.service';
import { RedisService } from '../src/shared/redis/redis.service';
import { buildSfuBinary, E2E_SFU_HTTP_PORT, E2E_SFU_UDP_MAX, E2E_SFU_UDP_MIN, SfuProcess } from './helpers/sfu-process';

/**
 * End-to-end test of the signaling layer against a real media plane.
 *
 * Real WebSocket clients (the `ws` package: indistinguishable from a
 * browser's native WebSocket at the protocol level) talk to the real
 * running app, backed by the real Postgres and Redis (`docker compose up
 * -d postgres redis`), which in turn talks to a **real Raven SFU** built
 * from `services/sfu` and spawned as a child process. Nothing between the
 * client and Pion is faked.
 *
 * RTC tokens are minted through the real HTTP control-plane endpoints, not
 * hand-constructed, except where a test explicitly needs a token the API
 * would never issue (see "authentication").
 *
 * # What replaced what
 *
 * The predecessor of this file tested a full-mesh relay: it asserted that
 * an `sdp.offer` carrying a `targetParticipantId` came out of another
 * participant's socket with a `fromParticipantId` attached. None of that
 * survives: a client has exactly one peer now, the node serving its
 * room, so the server is a party to the negotiation instead of a
 * courier. The tests that checked forwarding between browsers were
 * deleted, not adapted, because there is nothing left for them to
 * describe; `PARTICIPANT_NOT_FOUND` for a cross-room SDP target went with
 * them, since a message no longer names a target to be wrong about.
 *
 * # What this proves, and what it does not
 *
 * It proves the control path end to end: a minted token authenticates a
 * WebSocket, `room.join` allocates a real registered node, that node
 * creates a real `RTCPeerConnection` and offers first, and the offer that
 * reaches the client is a genuine session description with ICE
 * credentials and a DTLS fingerprint in it.
 *
 * It does **not** prove media flows, because `ws` is not a WebRTC
 * endpoint: there is nothing here to answer the offer or gather
 * candidates. Forwarding, simulcast, keyframe gating and RTCP recovery
 * are covered against real Pion peers in `services/sfu/internal/room`
 * (`media_test.go`, `downtrack_test.go`, `keyframe_test.go`) and at
 * 2/10/50/100 participants in `scale_test.go`. Neither this file nor
 * those is a substitute for the browser matrix in
 * `docs/rtc/test-matrix.md`.
 */
describe('Signaling (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsBaseUrl: string;
  let configService: ConfigService;
  let tokenSigner: RtcTokenSignerService;
  let redisService: RedisService;
  let sfu: SfuProcess | undefined;
  let sfuUnavailableReason: string | undefined;
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const sfuNodeId = `sfu-e2e-${uniqueSuffix}`.slice(0, 128);
  /**
   * A region nothing else can be in.
   *
   * Without this the suite is at the mercy of whatever else is registered
   * on the machine: a `docker compose up sfu`, a node left over from a
   * crashed run, because the allocator picks the least-loaded healthy
   * node in the requested region and an idle stranger looks like the best
   * choice. Every `room.join` below asks for this region, so allocation
   * lands on the node this suite started and no other. It also means the
   * region preference itself is exercised on every single join rather
   * than in one test that could rot.
   */
  const sfuRegion = `e2e-${uniqueSuffix}`.slice(0, 64);

  let jwtToken: string;
  let projectId: string;
  let apiKey: string;

  // Building the SFU on a cold Go module cache dominates this suite's
  // runtime; the per-test default of 5s does not apply to hooks but the
  // suite-level timeout does.
  jest.setTimeout(300_000);

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
    wsBaseUrl = `ws://127.0.0.1:${port}/v1/rtc`;
    configService = app.get(ConfigService);
    // Used only where a test needs a token the API would never mint: an
    // already-expired one. Everything else goes through the real endpoint.
    tokenSigner = app.get(RtcTokenSignerService);

    redisService = app.get(RedisService);
    const staleKeys = await redisService.client.keys('ratelimit:*');
    if (staleKeys.length > 0) {
      await redisService.client.del(...staleKeys);
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
    projectId = projectRes.body.id;

    const keyRes = await request(baseUrl)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({})
      .expect(201);
    apiKey = keyRes.body.key;

    // --- the media plane ---
    const binary = await buildSfuBinary();
    if (!binary) {
      // Recorded and reported, never silently skipped. A suite that
      // quietly stops testing the media plane reads as green while
      // covering strictly less than it claims.
      sfuUnavailableReason =
        'Go is not installed, so services/sfu could not be built. Install Go (https://go.dev/dl/) to run the media-plane tests.';
      return;
    }

    sfu = new SfuProcess(binary, {
      controlPlaneUrl: baseUrl,
      registrationSecret: configService.get<string>('sfu.registrationSecret')!,
      nodeId: sfuNodeId,
      region: sfuRegion,
      httpPort: E2E_SFU_HTTP_PORT,
      udpPortMin: E2E_SFU_UDP_MIN,
      udpPortMax: E2E_SFU_UDP_MAX,
    });

    await sfu.start(async () => {
      const res = await request(baseUrl).get('/v1/rtc/servers').set('Authorization', `Bearer ${jwtToken}`);
      return (
        res.status === 200 &&
        res.body.some((node: { name: string; status: string }) => node.name === sfuNodeId && node.status === 'HEALTHY')
      );
    });
  });

  afterAll(async () => {
    await sfu?.stop();

    // Delete this suite's registry row before closing the app.
    //
    // A node that shuts down has no way to deregister: it just stops
    // heartbeating, and the control plane sweeps it to UNHEALTHY after
    // `SFU_HEARTBEAT_TIMEOUT_SECONDS`. That is right for production (a
    // node dying is indistinguishable from a network blip) and wrong for
    // a test suite: for the next 30 seconds the row still says HEALTHY at
    // an address nothing is listening on, and `/health` in a *later* suite
    // picks it and correctly reports the SFU as down. The failure lands
    // somewhere else entirely, which is the worst kind of test pollution.
    if (sfu) {
      await app
        ?.get(PrismaService)
        .rtcServer.deleteMany({ where: { name: sfuNodeId } })
        .catch(() => undefined);
    }

    await app?.close();
  });

  /**
   * Resets the per-IP connection budget between tests.
   *
   * The signaling upgrade allows 20 connections per minute per IP, and
   * this suite opens roughly twice that from 127.0.0.1, so without this,
   * the tests that happen to run later fail with `RATE_LIMITED` for
   * reasons that have nothing to do with what they assert. Same problem
   * `maxWorkers: 1` exists to solve in `jest-e2e.json`, one level down.
   *
   * Clearing the budget does not drop coverage of the limiter: it is
   * asserted on purpose in "rate limiting" below, and unit-tested in
   * `connection-rate-limit.service.spec.ts`.
   */
  beforeEach(async () => {
    const keys = await redisService.client.keys('ratelimit:signaling:*');
    if (keys.length > 0) {
      await redisService.client.del(...keys);
    }
  });

  /** Fails the suite loudly rather than skipping when the media plane is absent. */
  function requireSfu(): void {
    if (sfuUnavailableReason) {
      throw new Error(sfuUnavailableReason);
    }
  }

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

    return {
      token: await mintTokenForRoom(roomRes.body.id, participantIdentity, permissions),
      roomId: roomRes.body.id,
    };
  }

  /** A second (third, …) token for a room that already exists. */
  async function mintTokenForRoom(
    roomId: string,
    participantIdentity: string,
    permissions: Record<string, boolean> = { join: true, subscribe: true, publish: true },
  ): Promise<string> {
    const res = await request(baseUrl)
      .post(`/v1/rooms/${roomId}/rtc-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ participantIdentity, permissions })
      .expect(201);
    return res.body.token;
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

    waitFor(predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
      const already = this.received.find(predicate);
      if (already) {
        return Promise.resolve(already);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `timed out waiting for a message matching predicate; received: ` + JSON.stringify(this.received),
              ),
            ),
          timeoutMs,
        );
        this.waiters.push({ predicate, resolve, reject, timer });
      });
    }

    waitForType(type: string, timeoutMs = 5000): Promise<any> {
      return this.waitFor((msg) => msg.type === type, timeoutMs);
    }

    /**
     * Asserts a message type does *not* arrive.
     *
     * Needed for the negative half of a permission check: an unauthorized
     * action that is silently accepted looks identical to one that is
     * correctly rejected unless you wait and see nothing.
     */
    async expectNo(type: string, withinMs = 600): Promise<void> {
      await new Promise((r) => setTimeout(r, withinMs));
      const found = this.received.find((m: any) => m.type === type);
      expect(found).toBeUndefined();
    }

    send(message: Record<string, unknown>): void {
      this.socket.send(JSON.stringify(message));
    }

    close(): void {
      this.socket.close();
    }
  }

  describe('the media plane is real', () => {
    it('has a registered, healthy SFU node the control plane can see', async () => {
      requireSfu();

      const res = await request(baseUrl).get('/v1/rtc/servers').set('Authorization', `Bearer ${jwtToken}`).expect(200);

      const node = res.body.find((n: { name: string }) => n.name === sfuNodeId);
      expect(node).toBeDefined();
      expect(node.status).toBe('HEALTHY');
      expect(node.region).toBe(sfuRegion);
      // Registered by the node itself, not seeded by the test: this is
      // the whole point of a self-registering fleet.
      expect(node.internalUrl).toBe(`http://127.0.0.1:${E2E_SFU_HTTP_PORT}`);
    });

    it('keeps heartbeating, so the node stays allocatable', async () => {
      requireSfu();

      const first = await request(baseUrl)
        .get('/v1/rtc/servers')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const before = new Date(first.body.find((n: { name: string }) => n.name === sfuNodeId).lastHeartbeatAt).getTime();

      // The node's interval is 2s in this harness.
      await new Promise((r) => setTimeout(r, 3_000));

      const second = await request(baseUrl)
        .get('/v1/rtc/servers')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const after = new Date(second.body.find((n: { name: string }) => n.name === sfuNodeId).lastHeartbeatAt).getTime();

      expect(after).toBeGreaterThan(before);
    });
  });

  describe('authentication', () => {
    it('accepts a connection with a valid RTC token and joins a real node', async () => {
      requireSfu();

      const { token, roomId } = await mintToken('auth-room', 'alice');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });

      const joined = await client.waitForType('room.joined');
      expect(joined.roomId).toBe(roomId);
      expect(joined.participants).toEqual([]);
      // The node's *name*, never its address. A client that learned an
      // SFU's address could connect to it directly, and then the media
      // plane could not change without breaking that client.
      expect(joined.rtcServer).toBe(sfuNodeId);
      expect(joined.region).toBe(sfuRegion);
      expect(JSON.stringify(joined)).not.toContain(String(E2E_SFU_HTTP_PORT));

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
      const { roomId } = await mintToken('expiry-room', 'zack');

      // Signed through the real signer with the clock wound back, so the
      // signature is genuinely valid and only the expiry is against it.
      // The HTTP endpoint enforces a 30-second minimum TTL, so an
      // already-expired token cannot be obtained through it.
      const realNow = Date.now;
      Date.now = () => realNow() - 3_600_000;
      let expiredToken: string;
      try {
        expiredToken = tokenSigner.sign({
          projectId: 'whatever-project',
          environment: Environment.DEVELOPMENT,
          roomId,
          roomName: 'expiry-room',
          participantIdentity: 'zack',
          permissions: resolvePermissions(Object.assign(new RtcTokenPermissionsDto(), { join: true, subscribe: true })),
          ttlSeconds: 60,
        }).token;
      } finally {
        Date.now = realNow;
      }

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
      client.send({ type: 'room.join', region: sfuRegion });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PERMISSION_DENIED');
      client.close();
    });

    it('rejects a client-initiated offer without publish permission', async () => {
      requireSfu();

      const { token } = await mintToken('perm-offer-room', 'subscriber-only', {
        join: true,
        subscribe: true,
        publish: false,
      });
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      client.send({ type: 'sdp.offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PERMISSION_DENIED');

      client.close();
    });

    it('rejects track.publish without publish permission', async () => {
      requireSfu();

      const { token } = await mintToken('perm-publish-room', 'watcher', {
        join: true,
        subscribe: true,
        publish: false,
      });
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      client.send({ type: 'track.publish', trackId: 'sneaky', source: 'camera' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PERMISSION_DENIED');

      client.close();
    });

    it('rejects subscription.update without subscribe permission', async () => {
      requireSfu();

      const { token } = await mintToken('perm-sub-room', 'publisher-only', {
        join: true,
        subscribe: false,
        publish: true,
      });
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      client.send({
        type: 'subscription.update',
        publisherId: 'somebody',
        trackId: 'some-track',
        layer: 'low',
      });
      const error = await client.waitForType('error');
      expect(error.code).toBe('PERMISSION_DENIED');

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

    it('rejects an sdp message with no sdp body', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'sdp.answer' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });

    it('accepts an sdp message that carries no targetParticipantId', async () => {
      // The inverse of the mesh protocol's requirement, and the reason
      // this file was rewritten: a target is not merely optional now, it
      // is meaningless. Rejected for being out of room, not malformed.
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'sdp.answer', sdp: 'v=0\r\n' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('NOT_IN_ROOM');
      client.close();
    });

    it('rejects an unrecognised track source rather than defaulting it', async () => {
      // A screen share rendered as somebody's face is worse than an error.
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'track.publish', trackId: 't1', source: 'hologram' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      expect(error.message).toContain('screenShare');
      client.close();
    });

    it('rejects an unrecognised simulcast layer rather than substituting one', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({
        type: 'subscription.update',
        publisherId: 'bob',
        trackId: 'bob-cam',
        layer: 'ultra',
      });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      expect(error.message).toContain('low');
      client.close();
    });

    it('rejects an ice.candidate with a non-string candidate', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'ice.candidate', candidate: { foo: 'bar' } });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });

    it('rejects an oversized message', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      const maxBytes = configService.get<number>('signaling.maxMessageBytes')!;
      client.send({ type: 'sdp.answer', sdp: 'a'.repeat(maxBytes + 1000) });
      const error = await client.waitForType('error');
      expect(error.code).toBe('INVALID_MESSAGE');
      client.close();
    });

    it('rejects everything before room.join with NOT_IN_ROOM', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'track.mute', trackId: 'x', muted: true });
      const error = await client.waitForType('error');
      expect(error.code).toBe('NOT_IN_ROOM');
      client.close();
    });

    it('answers ping with pong without needing a room', async () => {
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'ping' });
      await client.waitForType('pong');
      client.close();
    });
  });

  describe('negotiation against the real SFU', () => {
    it('the SFU offers first, with a genuine session description', async () => {
      requireSfu();

      const { token } = await mintToken('offer-room', 'offeree');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      // The node creates a real RTCPeerConnection and offers as soon as
      // the participant is added: it owns the subscriber side and, on
      // join, already knows every track the participant should receive.
      const offer = await client.waitForType('sdp.offer', 10_000);
      const sdp: string = offer.sdp;

      // Pion's own output, not a fixture. These lines are what make it a
      // session description instead of a string the test agreed to
      // accept: an origin, ICE credentials, and a DTLS fingerprint.
      expect(sdp).toMatch(/^v=0\r?\n/);
      expect(sdp).toContain('o=-');
      expect(sdp).toMatch(/a=ice-ufrag:/);
      expect(sdp).toMatch(/a=ice-pwd:/);
      expect(sdp).toMatch(/a=fingerprint:sha-256 /);
      // The offerer must let the answerer pick the DTLS role.
      expect(sdp).toContain('a=setup:actpass');

      client.close();
    });

    it('trickles real ICE candidates from the node', async () => {
      requireSfu();

      const { token } = await mintToken('ice-room', 'gatherer');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');
      await client.waitForType('sdp.offer', 10_000);

      const candidate = await client.waitForType('ice.candidate', 10_000);
      expect(typeof candidate.candidate).toBe('string');
      expect(candidate.candidate).toMatch(/^candidate:/);
      // Bound inside the range the node was configured with, which is
      // what makes a firewall rule for a deployment writable at all.
      const port = Number(candidate.candidate.split(/\s+/)[5]);
      expect(port).toBeGreaterThanOrEqual(E2E_SFU_UDP_MIN);
      expect(port).toBeLessThanOrEqual(E2E_SFU_UDP_MAX);

      client.close();
    });

    it('refuses a client-initiated offer while the node has one in flight', async () => {
      requireSfu();

      const { token } = await mintToken('glare-room', 'glarer');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');
      await client.waitForType('sdp.offer', 10_000);

      // The node's own offer is unanswered, `ws` cannot answer it, so a
      // client-initiated offer now collides. Glare is resolved by rule
      // (the SFU is the impolite peer), not by luck, and the error
      // is retryable: answer the offer already on its way, then retry.
      client.send({
        type: 'sdp.offer',
        sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
      });
      const error = await client.waitForType('error', 10_000);
      expect(error.code).toBe('NEGOTIATION_GLARE');

      client.close();
    });

    // `connection.state` is not asserted here, on purpose. The node
    // emits it from Pion's `OnConnectionStateChange`, which does not fire
    // until a remote description is set, and `ws` cannot answer an
    // offer, so the PeerConnection stays in `new` for this suite's whole
    // life. Asserting it would mean waiting for something that correctly
    // never arrives. It is covered in
    // `services/sfu/internal/signal/server_test.go`, against a Pion peer
    // that does answer.
  });

  describe('room membership', () => {
    it('tells a joiner who is already in the room, and the room who joined', async () => {
      requireSfu();

      const { token: tokenA, roomId } = await mintToken('membership-room', 'participant-a');
      const tokenB = await mintTokenForRoom(roomId, 'participant-b');

      const clientA = new TestClient(tokenA);
      const clientB = new TestClient(tokenB);
      await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);

      clientA.send({ type: 'room.join', region: sfuRegion });
      const aJoined = await clientA.waitForType('room.joined');
      expect(aJoined.participants).toEqual([]);

      clientB.send({ type: 'room.join', region: sfuRegion });
      const bJoined = await clientB.waitForType('room.joined');
      // With tracks, so a client joining a call in progress can render
      // the room in one pass rather than filling an empty grid from a
      // stream of events it must distinguish from genuinely new ones.
      expect(bJoined.participants).toEqual([{ id: 'participant-a', tracks: [] }]);

      const aSeesBJoin = await clientA.waitForType('participant.joined');
      expect(aSeesBJoin.participant).toEqual({ id: 'participant-b', tracks: [] });

      // Both are on the same node: one room, one media plane.
      expect(bJoined.rtcServer).toBe(aJoined.rtcServer);

      clientA.close();
      clientB.close();
    });

    it('broadcasts a mute to the room without renegotiating', async () => {
      requireSfu();

      const { token: tokenA, roomId } = await mintToken('mute-room', 'muter');
      const tokenB = await mintTokenForRoom(roomId, 'listener');

      const publisher = new TestClient(tokenA);
      const listener = new TestClient(tokenB);
      await Promise.all([publisher.waitForOpen(), listener.waitForOpen()]);
      publisher.send({ type: 'room.join', region: sfuRegion });
      await publisher.waitForType('room.joined');
      listener.send({ type: 'room.join', region: sfuRegion });
      await listener.waitForType('room.joined');

      publisher.send({ type: 'track.mute', trackId: 'cam-1', muted: true });
      const muted = await listener.waitForType('track.muted');
      expect(muted).toEqual({
        type: 'track.muted',
        participantId: 'muter',
        trackId: 'cam-1',
      });

      publisher.send({ type: 'track.mute', trackId: 'cam-1', muted: false });
      const unmuted = await listener.waitForType('track.unmuted');
      expect(unmuted.participantId).toBe('muter');

      // The publisher is not told about its own mute: it already knows.
      await publisher.expectNo('track.muted');

      publisher.close();
      listener.close();
    });

    it('does not confirm a subscription.update, because the delivered layer is not knowable here', async () => {
      requireSfu();

      const { token } = await mintToken('layer-room', 'switcher');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      client.send({
        type: 'subscription.update',
        publisherId: 'nobody',
        trackId: 'nothing',
        layer: 'low',
      });

      // No ack and no error: the requested layer is a preference, and the
      // layer actually delivered depends on what the publisher sends. A
      // success reply would let a UI claim a quality it may not have.
      await client.expectNo('error');

      client.close();
    });

    // `ROOM_FULL` is not exercised here. The limit is deployment-wide
    // (`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`, default 50) instead of a
    // per-room field, so provoking it would mean opening fifty sockets to
    // re-test one comparison: see `room-registry.service.spec.ts`, which
    // tests it directly, including that a reconnecting participant is not
    // counted twice against the cap.
  });

  describe('live room state, read back through the control plane', () => {
    it('reports real participants for a room with a live session', async () => {
      requireSfu();

      const { token, roomId } = await mintToken('state-read-room', 'present-person');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');

      const res = await request(baseUrl)
        .get(`/v1/projects/${projectId}/rooms/${roomId}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // Read from the node, not from the participants table: the two can
      // legitimately disagree, and only one of them knows who is on the
      // call right now.
      expect(res.body.liveParticipants).toEqual([expect.objectContaining({ identity: 'present-person' })]);
      expect(res.body.liveParticipantCount).toBe(1);

      client.close();
    });

    it('reports an idle room as 0, which is different from unknown', async () => {
      requireSfu();

      const roomRes = await request(baseUrl)
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `idle-room-${Date.now()}-${Math.random().toString(36).slice(2)}` })
        .expect(201);

      const res = await request(baseUrl)
        .get(`/v1/projects/${projectId}/rooms/${roomRes.body.id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // Zero, not null. Nobody has ever joined, so no node was allocated,
      // and the control plane knows the room is idle without asking
      // anyone. Null would mean "could not find out", which is a much
      // weaker statement and would render as a partition in the dashboard.
      expect(res.body.liveParticipantCount).toBe(0);
      expect(res.body.liveParticipants).toEqual([]);
    });
  });

  describe('rate limiting', () => {
    it('refuses connections past the per-IP budget, and says so before closing', async () => {
      const limit = configService.get<number>('signaling.maxConnectionsPerWindow')!;
      const { token } = await mintToken('ratelimit-room', 'flooder');

      // Up to the limit is allowed. Held open, because the limiter counts
      // upgrades within a window, not concurrent sockets: closing
      // them would not give the budget back.
      const allowed: TestClient[] = [];
      for (let i = 0; i < limit; i++) {
        const client = new TestClient(token);
        await client.waitForOpen();
        allowed.push(client);
      }

      const refused = new TestClient(token);
      await refused.waitForOpen();
      const error = await refused.waitForType('error');
      expect(error.code).toBe('RATE_LIMITED');
      // An error frame *then* a close, so a client can tell "too fast,
      // back off" from "your credential is bad" and does not retry a
      // token refresh that would not have helped.
      const closeInfo = await refused.waitForClose();
      expect(closeInfo.code).toBeGreaterThanOrEqual(4000);

      for (const client of allowed) {
        client.close();
      }
    });
  });

  describe('connection lifecycle', () => {
    it('removes a participant from room state on abrupt disconnect', async () => {
      requireSfu();

      const { token: tokenA, roomId } = await mintToken('disconnect-room', 'eve');
      const tokenB = await mintTokenForRoom(roomId, 'frank', { join: true, subscribe: true });

      const clientEve = new TestClient(tokenA);
      const clientFrank = new TestClient(tokenB);
      await Promise.all([clientEve.waitForOpen(), clientFrank.waitForOpen()]);
      clientEve.send({ type: 'room.join', region: sfuRegion });
      await clientEve.waitForType('room.joined');
      clientFrank.send({ type: 'room.join', region: sfuRegion });
      await clientFrank.waitForType('room.joined');
      await clientEve.waitForType('participant.joined');

      // Abrupt, not a graceful room.leave.
      clientEve.socket.terminate();
      const frankSeesLeave = await clientFrank.waitForType('participant.left');
      expect(frankSeesLeave.participant).toEqual({ id: 'eve' });

      clientFrank.close();
    });

    it('leaves gracefully and tells the room', async () => {
      requireSfu();

      const { token: tokenA, roomId } = await mintToken('leave-room', 'goer');
      const tokenB = await mintTokenForRoom(roomId, 'stayer');

      const goer = new TestClient(tokenA);
      const stayer = new TestClient(tokenB);
      await Promise.all([goer.waitForOpen(), stayer.waitForOpen()]);
      goer.send({ type: 'room.join', region: sfuRegion });
      await goer.waitForType('room.joined');
      stayer.send({ type: 'room.join', region: sfuRegion });
      await stayer.waitForType('room.joined');

      goer.send({ type: 'room.leave' });
      const left = await goer.waitForType('room.left');
      expect(left.roomId).toBe(roomId);
      const stayerSees = await stayer.waitForType('participant.left');
      expect(stayerSees.participant).toEqual({ id: 'goer' });

      goer.close();
      stayer.close();
    });

    it('supports reconnection: a new connection for the same identity replaces the old one', async () => {
      requireSfu();

      const { token } = await mintToken('reconnect-room', 'gina');

      const first = new TestClient(token);
      await first.waitForOpen();
      first.send({ type: 'room.join', region: sfuRegion });
      await first.waitForType('room.joined');

      // Reconnect: same participant identity, a brand new connection.
      const second = new TestClient(token);
      await second.waitForOpen();
      second.send({ type: 'room.join', region: sfuRegion });
      await second.waitForType('room.joined');

      // The old connection must be told it was replaced and closed.
      const kickError = await first.waitForType('error');
      expect(kickError.code).toBe('UNAUTHORIZED');
      const closeInfo = await first.waitForClose();
      expect(closeInfo.code).toBe(4002);

      // And the reconnected client gets a fresh offer, because there is no
      // session resumption: the media session is rebuilt from scratch.
      await second.waitForType('sdp.offer', 10_000);

      second.close();
    });

    it('rejects a message sent after a graceful leave', async () => {
      requireSfu();

      const { token } = await mintToken('after-leave-room', 'harry');
      const client = new TestClient(token);
      await client.waitForOpen();
      client.send({ type: 'room.join', region: sfuRegion });
      await client.waitForType('room.joined');
      client.send({ type: 'room.leave' });
      await client.waitForType('room.left');

      client.send({ type: 'sdp.answer', sdp: 'v=0\r\n' });
      const error = await client.waitForType('error');
      expect(error.code).toBe('NOT_IN_ROOM');

      client.close();
    });
  });
});
