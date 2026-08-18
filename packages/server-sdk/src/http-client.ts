import { RavenError } from './errors';
import { SDK_VERSION } from './version';

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const DEFAULT_BASE_URL = 'http://localhost:4100';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 300;

export interface RavenClientOptions {
  /** Required — a project API key (`rvk_....secret`). Never hardcode this in source; pass it from an environment variable your own code reads explicitly (e.g. `apiKey: process.env.RAVEN_API_KEY`). */
  apiKey: string;
  /** Defaults to http://localhost:4100 (local dev). Override for any real deployment. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 10000. A request never hangs indefinitely. */
  timeout?: number;
  /** Max retry attempts for transient failures (network errors, 429/502/503/504). Defaults to 2. */
  maxRetries?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Set false for requests that must never be retried even on a transient failure. */
  retryable?: boolean;
}

/**
 * The one place this SDK talks HTTP to the Control API — every resource
 * goes through this, never constructing a `fetch()` of its own (Phase 10
 * spec §8/§9). The API key lives only in a private class field: it is
 * never a property on `this` reachable via `Object.keys`/`JSON.stringify`/
 * `console.log`, and this class's own `toString`/inspect output never
 * includes it either (Phase 10 spec §7).
 */
export class RavenHttpClient {
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(options: RavenClientOptions) {
    if (!options || typeof options !== 'object') {
      throw new RavenError('new Raven(options) requires a configuration object', { code: 'INVALID_CONFIG' });
    }
    if (!options.apiKey || typeof options.apiKey !== 'string') {
      throw new RavenError('apiKey is required — pass your Raven project API key, e.g. apiKey: process.env.RAVEN_API_KEY', {
        code: 'INVALID_CONFIG',
      });
    }

    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Never returns the API key — safe to log, inspect, or JSON.stringify this client itself. */
  toString(): string {
    return `RavenHttpClient(${this.baseUrl})`;
  }

  toJSON(): unknown {
    return { baseUrl: this.baseUrl };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);
    const retryable = options.retryable ?? true;

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.#apiKey}`,
            'User-Agent': `Raven-Server-SDK/${SDK_VERSION} (node)`,
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        if (retryable && attempt < this.maxRetries) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new RavenError(isTimeout ? `Request timed out after ${this.timeout}ms` : 'Could not reach the Raven API', {
          code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          cause: error,
        });
      }
      clearTimeout(timer);

      const requestId = response.headers.get('x-request-id') ?? undefined;

      if (response.status === 204) {
        return undefined as T;
      }

      const payload = await response.json().catch(() => undefined);

      if (response.ok) {
        return payload as T;
      }

      if (retryable && RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.maxRetries) {
        await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
        attempt++;
        continue;
      }

      throw mapErrorResponse(response.status, payload, requestId);
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

function mapErrorResponse(status: number, payload: unknown, requestId?: string): RavenError {
  const message = extractMessage(payload) ?? `Request failed with status ${status}`;
  const code = extractCode(payload) ?? codeForStatus(status);
  return new RavenError(message, { code, statusCode: status, requestId, details: payload });
}

function codeForStatus(status: number): string {
  if (status === 401) return 'AUTHENTICATION_ERROR';
  if (status === 403) return 'AUTHORIZATION_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'VALIDATION_ERROR';
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const message = (payload as Record<string, unknown>).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return undefined;
}

function extractCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const code = (payload as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
