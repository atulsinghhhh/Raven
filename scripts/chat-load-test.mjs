#!/usr/bin/env node
// Raven Chat load test (Phase 12 spec §55).
//
// Opens N real WebSocket connections against a running Raven API, has a
// share of them send messages at a fixed rate, and measures what actually
// happened. Nothing here is simulated or extrapolated — every number
// printed comes from a real socket carrying a real message through
// Postgres and Redis.
//
// The numbers this produces describe *the machine it ran on*. A laptop
// running Postgres, Redis, LiveKit, coturn, MinIO and the API in Docker
// alongside the load generator is not a capacity model for production;
// see docs/chat/architecture.md#measured-limits for what was measured and
// what it does and does not tell you.
//
// Usage:
//   node scripts/chat-load-test.mjs --connections 200 --senders 50 --rate 2 --duration 30
//
// Requires an API key with permission to create conversations and mint
// tokens. Set RAVEN_API_KEY, or pass --api-key.

import WebSocket from 'ws';

const args = parseArgs(process.argv.slice(2));
const API = args['api-url'] ?? process.env.RAVEN_API_URL ?? 'http://localhost:4100';
const API_KEY = args['api-key'] ?? process.env.RAVEN_API_KEY;
const CONNECTIONS = Number(args.connections ?? 100);
const SENDERS = Number(args.senders ?? 20);
const RATE = Number(args.rate ?? 1); // messages per second, per sender
const DURATION = Number(args.duration ?? 30); // seconds
const ROOMS = Number(args.rooms ?? 1);

if (!API_KEY) {
  console.error('Set RAVEN_API_KEY (or pass --api-key). Never use a chat token here — this script provisions rooms.');
  process.exit(1);
}

const metrics = {
  connectionsAttempted: 0,
  connectionsOpened: 0,
  connectionsFailed: 0,
  connectionsDropped: 0,
  messagesSent: 0,
  messagesAcked: 0,
  messagesFailed: 0,
  messagesReceived: 0,
  rateLimited: 0,
  /** Send → ack. This is "how long until Raven promised it was stored". */
  ackLatencies: [],
  /** Sender's clock → recipient's clock. Spans two clocks, so indicative only. */
  deliveryLatencies: [],
};

async function api(path, { method = 'GET', body, token = API_KEY } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function main() {
  const suffix = Date.now().toString(36);
  console.log(`Raven Chat load test`);
  console.log(`  api            ${API}`);
  console.log(`  connections    ${CONNECTIONS} across ${ROOMS} room(s)`);
  console.log(`  senders        ${SENDERS} at ${RATE} msg/s each (${(SENDERS * RATE).toFixed(1)} msg/s offered)`);
  console.log(`  duration       ${DURATION}s\n`);

  // Provision rooms and membership up front so the measured window is
  // pure messaging, not setup.
  console.log('provisioning…');
  const rooms = [];
  for (let r = 0; r < ROOMS; r++) {
    const members = [];
    for (let i = 0; i < Math.ceil(CONNECTIONS / ROOMS); i++) {
      members.push({ userId: `load-${suffix}-${r}-${i}` });
    }
    const conversation = await api('/v1/chat/conversations', {
      method: 'POST',
      body: { name: `loadtest-${suffix}-${r}`, members },
    });
    rooms.push(conversation.publicId);
  }

  const clients = [];
  const connectStarted = Date.now();

  for (let i = 0; i < CONNECTIONS; i++) {
    const roomIndex = i % ROOMS;
    const userId = `load-${suffix}-${roomIndex}-${Math.floor(i / ROOMS)}`;
    const room = rooms[roomIndex];

    const minted = await api('/v1/chat/tokens', {
      method: 'POST',
      body: { userId, conversations: [room], ttlSeconds: 3600 },
    });

    metrics.connectionsAttempted++;
    const client = await openSocket(minted, room, userId).catch((error) => {
      metrics.connectionsFailed++;
      // Print the first few, then stop — a hundred identical lines helps
      // nobody, and the first one already says what's wrong.
      if (metrics.connectionsFailed <= 3) console.error(`  connection failed: ${error.message}`);
      return null;
    });
    if (client) clients.push(client);

    // If nothing at all is connecting, keep going is pointless.
    if (metrics.connectionsFailed >= 10 && metrics.connectionsOpened === 0) {
      console.error('\n  aborting: the first 10 connections all failed');
      process.exit(1);
    }

    if ((i + 1) % 25 === 0) {
      process.stdout.write(`  ${i + 1}/${CONNECTIONS} connected\r`);
    }
  }

  const connectMs = Date.now() - connectStarted;
  console.log(`\n  ${metrics.connectionsOpened} connected in ${(connectMs / 1000).toFixed(1)}s (${metrics.connectionsFailed} failed)\n`);

  if (clients.length === 0) {
    console.error('no connections opened — aborting');
    process.exit(1);
  }

  console.log(`sending for ${DURATION}s…`);
  const senders = clients.slice(0, Math.min(SENDERS, clients.length));
  const intervalMs = Math.max(1, Math.round(1000 / RATE));
  let sequence = 0;

  const timers = senders.map((client) =>
    setInterval(() => {
      const id = `s${sequence++}`;
      const sentAt = Date.now();
      client.pending.set(id, sentAt);
      metrics.messagesSent++;
      try {
        client.socket.send(
          JSON.stringify({
            type: 'message.send',
            id,
            room: client.room,
            text: `load ${id} ${sentAt}`,
            clientMessageId: `${client.userId}-${id}`,
            clientSentAt: sentAt,
          }),
        );
      } catch {
        metrics.messagesFailed++;
      }
    }, intervalMs),
  );

  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, DURATION * 1000));
  for (const timer of timers) clearInterval(timer);

  // Let in-flight messages land before measuring.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  for (const client of clients) client.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  report(elapsedSeconds, connectMs);
  process.exit(0);
}

function openSocket(minted, room, userId) {
  return new Promise((resolve, reject) => {
    // Host/port from API (what --api-url actually points at), not from
    // minted.chatUrl: the server always advertises its own configured
    // public URL there, which is right for a real deployment behind one
    // shared load balancer but wrong when --api-url points at one
    // specific instance behind its own port (see
    // scripts/k6/chat-scaled-load-test.sh, which runs one of these per
    // horizontally-scaled replica). The path still comes from chatUrl,
    // in case that's ever not the default CHAT_PATH.
    const chatPath = new URL(minted.chatUrl).pathname;
    const url = `${API.replace(/^http/, 'ws')}${chatPath}`;
    const socket = new WebSocket(`${url}?token=${encodeURIComponent(minted.token)}&sdkVersion=loadtest&platform=node`);
    const client = { socket, room, userId, pending: new Map() };

    const timeout = setTimeout(() => reject(new Error('connect timeout')), 15_000);

    socket.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.type === 'connected') {
        socket.send(JSON.stringify({ type: 'room.join', id: 'join', room }));
        return;
      }
      if (frame.type === 'room.joined') {
        clearTimeout(timeout);
        joined = true;
        metrics.connectionsOpened++;
        resolve(client);
        return;
      }
      if (frame.type === 'ack' && client.pending.has(frame.id)) {
        metrics.ackLatencies.push(Date.now() - client.pending.get(frame.id));
        client.pending.delete(frame.id);
        metrics.messagesAcked++;
        return;
      }
      if (frame.type === 'message') {
        metrics.messagesReceived++;
        // The sender stamped clientSentAt into the text; parse it back to
        // get an end-to-end figure. Two clocks, but both are this process.
        const match = /load s\d+ (\d+)$/.exec(frame.message?.text ?? '');
        if (match) metrics.deliveryLatencies.push(Date.now() - Number(match[1]));
        return;
      }
      if (frame.type === 'error') {
        if (frame.code === 'RATE_LIMITED') metrics.rateLimited++;
        else metrics.messagesFailed++;
        if (frame.id) client.pending.delete(frame.id);
      }
    });

    let joined = false;
    socket.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (joined) {
        metrics.connectionsDropped++;
        return;
      }
      // Closed before it ever joined — reject now rather than sitting on
      // the connect timeout. 4429 in particular means the per-IP
      // connection limiter refused us, which is a configuration problem
      // with the *test*, not a server fault, so say so plainly.
      reject(
        new Error(
          code === 4429
            ? `refused by the per-IP connection rate limit (close ${code}). Raise CHAT_CONNECTION_RATE_LIMIT on the API for load testing — see docs/chat/architecture.md#measured-limits`
            : `closed before joining (code ${code}${reason ? `, ${reason}` : ''})`,
        ),
      );
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(elapsedSeconds, connectMs) {
  const memory = process.memoryUsage();
  const line = (label, value) => console.log(`  ${label.padEnd(28)} ${value}`);

  console.log('\n─── results ───');
  line('connections attempted', metrics.connectionsAttempted);
  line('connections opened', metrics.connectionsOpened);
  line('connections failed', metrics.connectionsFailed);
  line('mean connect time', `${(connectMs / Math.max(1, metrics.connectionsAttempted)).toFixed(1)} ms`);

  console.log('');
  line('messages sent', metrics.messagesSent);
  line('messages acked (stored)', metrics.messagesAcked);
  line('messages failed', metrics.messagesFailed);
  line('rate limited', metrics.rateLimited);
  line('fan-out deliveries received', metrics.messagesReceived);
  line('offered rate', `${(metrics.messagesSent / elapsedSeconds).toFixed(1)} msg/s`);
  line('acked rate', `${(metrics.messagesAcked / elapsedSeconds).toFixed(1)} msg/s`);
  line('delivery rate', `${(metrics.messagesReceived / elapsedSeconds).toFixed(1)} deliveries/s`);

  console.log('\n  send → ack (durably stored)');
  for (const p of [50, 95, 99]) {
    const value = percentile(metrics.ackLatencies, p);
    line(`    p${p}`, value === null ? 'no samples' : `${value} ms`);
  }

  console.log('\n  send → received by another client');
  for (const p of [50, 95, 99]) {
    const value = percentile(metrics.deliveryLatencies, p);
    line(`    p${p}`, value === null ? 'no samples' : `${value} ms`);
  }

  console.log('');
  line('load generator RSS', `${(memory.rss / 1024 / 1024).toFixed(0)} MB`);

  // State the caveat every time, not just in the docs — a number without
  // its context is how a benchmark turns into a false claim.
  console.log(
    '\n  These figures describe this machine and this configuration only.\n' +
      '  The load generator shares CPU with the server it is measuring, so\n' +
      '  latency here is a ceiling, not a projection for a real deployment.',
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}

main().catch((error) => {
  console.error('\nload test failed:', error.message);
  process.exit(1);
});
