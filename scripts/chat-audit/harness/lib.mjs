// Minimal external-developer harness. Talks to Raven over plain HTTP/WS only.
// Nothing here imports anything from apps/api — this is what a third party has.
import WebSocket from 'ws';

export const BASE = process.env.RAVEN_BASE ?? 'http://localhost:4177';
export const WS_BASE = BASE.replace(/^http/, 'ws') + '/v1/chat/ws';

export async function http(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

export function must(r, expected, what) {
  const ok = Array.isArray(expected) ? expected.includes(r.status) : r.status === expected;
  if (!ok) throw new Error(`${what}: expected ${expected}, got ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
}

/** A chat WebSocket client with frame recording + awaiting. */
export class Client {
  constructor(token, label = 'client', opts = {}) {
    this.token = token;
    this.label = label;
    this.frames = [];
    this.waiters = [];
    this.opts = opts;
    this.closes = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({ token: this.token, sdkVersion: 'audit', platform: 'node' });
      if (this.opts.query) for (const [k, v] of Object.entries(this.opts.query)) qs.set(k, v);
      this.ws = new WebSocket(`${WS_BASE}?${qs}`, this.opts.wsOptions);
      this.ws.on('message', (raw) => {
        const f = JSON.parse(raw.toString());
        this.frames.push(f);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          if (this.waiters[i].pred(f)) {
            this.waiters[i].resolve(f);
            this.waiters.splice(i, 1);
          }
        }
        if (f.type === 'connected') {
          this.connectionId = f.connectionId;
          resolve(f);
        }
      });
      this.ws.on('close', (code, reason) => {
        this.closes.push({ code, reason: reason.toString() });
      });
      this.ws.on('error', () => {});
      this.ws.on('unexpected-response', (_r, res) => reject(new Error(`upgrade rejected ${res.statusCode}`)));
      setTimeout(
        () =>
          reject(
            new Error(
              `${this.label}: no 'connected' frame in 10s (frames=${JSON.stringify(this.frames)}, closes=${JSON.stringify(this.closes)})`,
            ),
          ),
        10_000,
      ).unref?.();
    });
  }
  waitFor(pred, ms = 5000, what = 'frame') {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`${this.label}: timeout waiting for ${what}`));
        }
      }, ms).unref?.();
    });
  }
  send(frame) {
    this.ws.send(JSON.stringify(frame));
  }
  /** Send a frame with a correlation id and await its ack/error. */
  async request(type, payload = {}, ms = 8000) {
    const id = `q${Math.random().toString(36).slice(2, 10)}`;
    const p = this.waitFor(
      (f) => f.id === id && ['ack', 'error', 'room.joined', 'room.left'].includes(f.type),
      ms,
      `${type} reply`,
    );
    this.send({ type, id, ...payload });
    const f = await p;
    if (f.type === 'error') {
      const e = new Error(f.message);
      e.code = f.code;
      e.frame = f;
      throw e;
    }
    return f.type === 'ack' ? f.data : f;
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      // Best effort: the socket may already be closed, or never opened.
    }
  }
  clear() {
    this.frames.length = 0;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
