import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const API = process.env.RAVEN_API_URL ?? 'https://api.ravenstack.online';
export const KEY = process.env.RAVEN_API_KEY;
const HARNESS = '/tmp/raven_harness';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

/**
 * One harness per server, mounted at `/`. Flutter's index.html carries
 * `<base href="/">`, so a sub-path mount makes it request
 * /flutter_bootstrap.js from the root and 404 — hence a port each.
 */
export function serve(harness, port) {
  const root = path.join(HARNESS, harness);
  if (!fs.existsSync(root)) throw new Error(`harness not built: ${root}`);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

async function api(method, p, body, token = KEY) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
export const post = (p, b, t) => api('POST', p, b, t);
export const get = (p, t) => api('GET', p, undefined, t);
export const del = (p, t) => api('DELETE', p, undefined, t);
export const patch = (p, b, t) => api('PATCH', p, b, t);

const FULL = { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true, publishData: true };

export async function makeRoom(name) {
  return post('/v1/rooms', { name, getOrCreate: true });
}
export async function rtcToken(roomId, identity, permissions = FULL) {
  return post(`/v1/rooms/${roomId}/rtc-tokens`, { participantIdentity: identity, permissions, ttlSeconds: 3600 });
}
export async function makeConversation(name, members) {
  return post('/v1/chat/conversations', { name, members, getOrCreate: true });
}
export async function chatToken(userId, conversations) {
  return post('/v1/chat/tokens', { userId, conversations, ttlSeconds: 3600 });
}

/** Poll window.__state until `predicate(state)` or timeout. Returns the last state. */
export async function waitForState(page, predicate, { timeout = 45000, label = 'state' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => globalThis.__state ?? null);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${label}; last state: ${JSON.stringify(last)}`);
}

export const results = [];
export function record(sdk, feature, pass, detail) {
  results.push({ sdk, feature, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${feature}${detail ? ` — ${detail}` : ''}`);
}
export function summarize() {
  const bySdk = {};
  for (const r of results) (bySdk[r.sdk] ??= []).push(r);
  console.log('\n================ SUMMARY ================');
  let failed = 0;
  for (const [sdk, rs] of Object.entries(bySdk)) {
    const p = rs.filter((r) => r.pass).length;
    failed += rs.length - p;
    console.log(`\n${sdk}: ${p}/${rs.length}`);
    for (const r of rs) if (!r.pass) console.log(`   FAILED: ${r.feature} — ${r.detail ?? ''}`);
  }
  console.log(`\nTOTAL: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  return failed;
}

export const CHROME_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];
