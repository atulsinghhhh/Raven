// Blended workload: REST reads, RTC token minting, and chat WS traffic
// running concurrently — the "mixed" data point the production-scale
// plan asks for alongside the per-surface tests, since a naive
// per-surface-only test can't show cross-surface contention (e.g. chat
// fan-out competing with REST request handling for the same event
// loop / DB pool).
//
// The chat client here is intentionally minimal (connect, join, send
// one message, wait for the ack, disconnect) — it exists to produce
// realistic *blended* traffic, not to replace scripts/chat-load-test.mjs
// as the dedicated chat measurement (see scripts/k6/README.md and
// scripts/k6/chat-scaled-load-test.sh for that).
//
// Usage:
//   TARGETS=$(scripts/k6/discover-api-targets.sh)
//   k6 run -e TARGETS="$TARGETS" scripts/k6/mixed-scenario.js \
//     --summary-export=scripts/results/mixed-$(date +%Y%m%dT%H%M%S).json

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { parseTargets, pickTarget } from './lib/targets.js';
import { provisionApiKey } from './lib/setup.js';

const targets = parseTargets(__ENV.TARGETS);

function stagesFor(envVar, fallbackPeak) {
  if (__ENV[envVar]) return JSON.parse(__ENV[envVar]);
  return [
    { duration: '30s', target: fallbackPeak },
    { duration: '2m', target: fallbackPeak },
    { duration: '30s', target: 0 },
  ];
}

export const options = {
  scenarios: {
    rest_traffic: {
      executor: 'ramping-vus',
      exec: 'restTraffic',
      startVUs: 0,
      stages: stagesFor('REST_STAGES', 200),
    },
    rtc_token_traffic: {
      executor: 'ramping-vus',
      exec: 'rtcTokenTraffic',
      startVUs: 0,
      stages: stagesFor('RTC_STAGES', 100),
    },
    chat_traffic: {
      executor: 'ramping-vus',
      exec: 'chatTraffic',
      startVUs: 0,
      stages: stagesFor('CHAT_STAGES', 100),
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true }],
  },
};

// A fixed pool rather than one unique userId per iteration: chat
// membership is checked at authorization time (conversations.authorize
// rejects NOT_A_MEMBER), so every chatting identity has to be a real
// member of the conversation — the same shape a real app's chat usage
// takes (known users, not infinite anonymous ones), and it keeps setup()
// to one bulk-membership call instead of a per-iteration add-member
// request.
const CHAT_USER_POOL_SIZE = 100; // CreateConversationDto caps `members` at 100 per request

export function setup() {
  const { apiKey } = provisionApiKey(targets[0]);

  const members = [];
  for (let i = 0; i < CHAT_USER_POOL_SIZE; i++) {
    members.push({ userId: `k6-chat-user-${i}` });
  }

  const convRes = http.post(
    `${targets[0]}/v1/chat/conversations`,
    JSON.stringify({ name: `k6-mixed-${Date.now()}`, members }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } },
  );
  if (convRes.status !== 201) {
    throw new Error(`setup: create conversation failed (${convRes.status}): ${convRes.body}`);
  }

  return { apiKey, conversationId: convRes.json('publicId') };
}

export function restTraffic(data) {
  const base = pickTarget(targets, __VU);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.apiKey}` };
  const res = http.get(`${base}/v1/rooms`, { headers, tags: { name: 'list_rooms' } });
  check(res, { 'list_rooms status 200': (r) => r.status === 200 });
  sleep(1);
}

export function rtcTokenTraffic(data) {
  const base = pickTarget(targets, __VU);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.apiKey}` };

  const roomRes = http.post(
    `${base}/v1/rooms`,
    JSON.stringify({ name: `k6-mixed-room-${__VU}-${__ITER}-${Date.now()}` }),
    { headers, tags: { name: 'create_room' } },
  );
  if (roomRes.status !== 201) return;

  const tokenRes = http.post(
    `${base}/v1/rooms/${roomRes.json('id')}/rtc-tokens`,
    JSON.stringify({
      participantIdentity: `k6-${__VU}-${__ITER}`,
      permissions: { join: true, subscribe: true, publish: true, publishAudio: true },
    }),
    { headers, tags: { name: 'mint_rtc_token' } },
  );
  check(tokenRes, { 'mint_rtc_token status 201': (r) => r.status === 201 });
  sleep(1);
}

export function chatTraffic(data) {
  const base = pickTarget(targets, __VU);
  const userId = `k6-chat-user-${(__VU - 1) % CHAT_USER_POOL_SIZE}`;

  const tokenRes = http.post(
    `${base}/v1/chat/tokens`,
    JSON.stringify({ userId, conversations: [data.conversationId], ttlSeconds: 300 }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.apiKey}` },
      tags: { name: 'mint_chat_token' },
    },
  );
  if (tokenRes.status !== 201) return;

  // Not tokenRes.json('chatUrl'): that's the server's own advertised
  // public URL (its configured API_PUBLIC_URL/API_PORT), which is
  // right for a real deployment behind one shared load balancer but
  // wrong here — each scaled-replica target has its own random host
  // port (see discover-api-targets.sh), and the point of this scenario
  // is to actually exercise the specific replica `base` was picked
  // from, not whichever one the server happens to advertise itself as.
  const wsBase = base.replace(/^http/, 'ws');
  const wsUrl = `${wsBase}/v1/chat/ws?token=${tokenRes.json('token')}`;
  const res = ws.connect(wsUrl, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'room.join', id: 'join1', room: data.conversationId }));
    });
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room.joined') {
        socket.send(
          JSON.stringify({
            type: 'message.send',
            id: 'send1',
            room: data.conversationId,
            text: `k6 mixed-scenario message ${__ITER}`,
          }),
        );
      }
      if (msg.type === 'ack' && msg.id === 'send1') {
        socket.close();
      }
    });
    socket.setTimeout(() => socket.close(), 10000);
  });
  check(res, { 'chat ws connected (101)': (r) => r && r.status === 101 });
}
