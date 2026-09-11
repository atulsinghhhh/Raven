/**
 * The control-plane calls the rig makes, all of them through the public
 * REST surface an integrator would use. No Prisma, no direct writes: if a
 * stream can only be set up by reaching around the API, the capacity
 * number would not describe anything a developer can reproduce.
 */

async function call(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const error = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    error.status = res.status;
    error.body = parsed;
    throw error;
  }
  return parsed;
}

export class ControlPlane {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async provision(suffix) {
    const registered = await call(this.baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: { email: `capacity-${suffix}@raven.local`, password: 'correct-horse-battery-staple' },
    });
    this.jwt = registered.accessToken;

    const project = await call(this.baseUrl, '/v1/projects', {
      method: 'POST',
      body: { name: `capacity-${suffix}` },
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    this.projectId = project.id;

    const key = await call(this.baseUrl, `/v1/projects/${project.id}/api-keys`, {
      method: 'POST',
      body: { name: 'capacity' },
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    this.apiKey = key.key;
    return { projectId: this.projectId, apiKey: this.apiKey };
  }

  /**
   * A second (or third, or eighteenth) project + key under the account
   * `provision()` already registered — without registering again.
   *
   * `POST /v1/auth/register` carries `@RateLimit(5)` keyed by IP
   * (`auth.controller.ts`), which every rig request shares since it all
   * originates from 127.0.0.1. A scenario that needs several API keys —
   * Phase 9 spreads mint load across enough keys to clear the per-key
   * viewer-token ceiling before it can call the pool the bottleneck —
   * hits that in a handful of calls if each key comes from its own
   * `provision()`. `POST /v1/projects` and its api-keys route carry no
   * such IP-keyed limit (they're gated by the caller's own JWT instead),
   * so minting many projects under one registered account is the
   * intended shape, not a workaround.
   */
  async provisionExtraProject(suffix) {
    if (!this.jwt) {
      throw new Error('provisionExtraProject() needs provision() to have run first — no JWT to create a project with');
    }
    const project = await call(this.baseUrl, '/v1/projects', {
      method: 'POST',
      body: { name: `capacity-${suffix}` },
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    const key = await call(this.baseUrl, `/v1/projects/${project.id}/api-keys`, {
      method: 'POST',
      body: { name: 'capacity' },
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    return { projectId: project.id, apiKey: key.key };
  }

  get authHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  createStream(title, hostIdentity = 'host') {
    return call(this.baseUrl, '/v1/live-streams', {
      method: 'POST',
      body: { title, hostIdentity },
      headers: this.authHeaders,
    });
  }

  startStream(streamId) {
    return call(this.baseUrl, `/v1/live-streams/${streamId}/start`, { method: 'POST', headers: this.authHeaders });
  }

  endStream(streamId) {
    return call(this.baseUrl, `/v1/live-streams/${streamId}/end`, { method: 'POST', headers: this.authHeaders });
  }

  getStream(streamId) {
    return call(this.baseUrl, `/v1/live-streams/${streamId}`, { headers: this.authHeaders });
  }

  addHost(streamId, identity, role = 'HOST') {
    return call(this.baseUrl, `/v1/live-streams/${streamId}/hosts`, {
      method: 'POST',
      body: { identity, role },
      headers: this.authHeaders,
    });
  }

  viewerToken(streamId, identity) {
    return call(this.baseUrl, `/v1/live-streams/${streamId}/viewer-tokens`, {
      method: 'POST',
      body: { identity },
      headers: this.authHeaders,
    });
  }

  /**
   * Mints viewer credentials with bounded concurrency.
   *
   * Serially would take a minute for a hundred viewers and would not
   * resemble an audience arriving; all at once would run straight into the
   * admission ceiling that `live-streams-capacity.e2e-spec.ts` already
   * measures, and this rig is not trying to re-measure it. The default
   * sits below `CAPACITY_MINT_CONCURRENCY` so that mint backpressure is
   * not silently folded into the media results.
   */
  async mintViewerTokens(streamId, identities, concurrency = 8) {
    const results = new Array(identities.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, identities.length) }, async () => {
      while (cursor < identities.length) {
        const index = cursor++;
        const startedAt = performance.now();
        try {
          const credentials = await this.viewerToken(streamId, identities[index]);
          results[index] = { ok: true, credentials, mintMs: performance.now() - startedAt };
        } catch (err) {
          results[index] = {
            ok: false,
            status: err.status ?? null,
            code: err.body?.code ?? err.body?.error?.code ?? null,
            message: err.message,
            mintMs: performance.now() - startedAt,
          };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  health() {
    return call(this.baseUrl, '/health');
  }
}

export { call as apiCall };
