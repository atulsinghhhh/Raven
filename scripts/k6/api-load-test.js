// REST control-plane load test (Rooms + RTC Tokens) — one leg of the
// four load-test surfaces the production-scale plan calls for
// (API / Chat / Signaling-via-RTC / Live Streaming / mixed).
//
// What this proves: the measured single-instance/N-instance ceiling for
// the authenticated REST surface, under the SLO defined by the
// thresholds below — a REAL number from a REAL run, not an estimate.
// What this does NOT prove: 10k/20k concurrent-user capacity on this
// machine — see scripts/k6/README.md's "what this can and can't prove"
// section. A single laptop originating tens of thousands of connections
// while also running the server under test is not a production capacity
// model; use this to find the per-instance ceiling and the multi-
// instance scaling efficiency, then extrapolate explicitly (never
// silently) from there.
//
// Usage:
//   TARGETS=$(scripts/k6/discover-api-targets.sh)   # or a single URL
//   k6 run -e TARGETS="$TARGETS" scripts/k6/api-load-test.js
//   # custom ramp:
//   k6 run -e TARGETS="$TARGETS" -e STAGES='[{"duration":"30s","target":100}]' \
//     scripts/k6/api-load-test.js
//
// Results should be redirected to scripts/results/ — nothing here
// writes there itself, to keep this script's job to "produce numbers",
// not "decide where they go" (see docs/production/capacity-report.md
// for how raw output there turns into the actual report):
//   k6 run ... --summary-export=scripts/results/api-load-test-$(date +%Y%m%dT%H%M%S).json

import http from 'k6/http';
import { check } from 'k6';
import { parseTargets, pickTarget } from './lib/targets.js';
import { provisionApiKey } from './lib/setup.js';

const targets = parseTargets(__ENV.TARGETS);

// Default ramp sweeps toward the 1K/5K/10K/20K tiers the plan asks for,
// but abortOnFail thresholds below mean a real run typically stops well
// before reaching the top of this ramp — that early stop *is* the
// measurement (the concurrency at which the SLO broke), not a failure
// of the script. Override via -e STAGES for a shorter/targeted run.
const DEFAULT_STAGES = [
  { duration: '30s', target: 100 },
  { duration: '30s', target: 1000 },
  { duration: '1m', target: 1000 },
  { duration: '30s', target: 5000 },
  { duration: '1m', target: 5000 },
  { duration: '30s', target: 10000 },
  { duration: '1m', target: 10000 },
  { duration: '30s', target: 20000 },
  { duration: '1m', target: 20000 },
  { duration: '30s', target: 0 },
];

export const options = {
  stages: __ENV.STAGES ? JSON.parse(__ENV.STAGES) : DEFAULT_STAGES,
  thresholds: {
    // The SLO. abortOnFail stops the whole run the moment it's
    // breached — that stopping point is the "ceiling" the capacity
    // report's methodology calls for, read off the ramp's VU count at
    // the moment of abort.
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true }],
    'http_req_duration{expected_response:true}': [
      { threshold: 'p(95)<500', abortOnFail: true },
    ],
  },
};

export function setup() {
  const { apiKey } = provisionApiKey(targets[0]);
  return { apiKey };
}

export default function (data) {
  const base = pickTarget(targets, __VU);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.apiKey}`,
  };

  const roomName = `k6-room-${__VU}-${__ITER}-${Date.now()}`;
  const createRes = http.post(
    `${base}/v1/rooms`,
    JSON.stringify({ name: roomName }),
    { headers, tags: { name: 'create_room' } },
  );
  const created = check(createRes, {
    'create_room status 201': (r) => r.status === 201,
  });
  if (!created) return;

  const roomId = createRes.json('id');

  const tokenRes = http.post(
    `${base}/v1/rooms/${roomId}/rtc-tokens`,
    JSON.stringify({
      participantIdentity: `k6-participant-${__VU}-${__ITER}`,
      permissions: { join: true, subscribe: true, publish: true, publishAudio: true },
    }),
    { headers, tags: { name: 'mint_rtc_token' } },
  );
  check(tokenRes, { 'mint_rtc_token status 201': (r) => r.status === 201 });

  const getRes = http.get(`${base}/v1/rooms/${roomId}`, {
    headers,
    tags: { name: 'get_room' },
  });
  check(getRes, { 'get_room status 200': (r) => r.status === 200 });
}
