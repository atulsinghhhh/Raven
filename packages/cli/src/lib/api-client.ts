import { randomUUID } from 'node:crypto';
import { CliError } from './errors.js';
import { debugLog } from './logger.js';
import type {
  ApiKeySummary,
  AuthResult,
  CreatedApiKey,
  HealthResponse,
  IssuedRtcToken,
  Project,
  RoomDetailWithLiveState,
  RoomWithLiveState,
} from './types.js';

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 300;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Statuses that must never trigger a retry — auth/authz/validation/not-found are never transient. */
  retryable?: boolean;
  /**
   * Overrides which HTTP statuses count as "return the body" vs. "throw".
   * Only /health needs this: the Control API deliberately returns 503 for
   * a *structured, still-parseable* degraded report (some dependency is
   * down), not a failed request — treating that as an error would discard
   * the very information `raven status` exists to show.
   */
  isSuccess?: (status: number) => boolean;
}

/**
 * The one place that knows how to talk HTTP to the Control API — every
 * command goes through this, never constructing a fetch() of its own
 * (Phase 8 spec §36). Centralizes auth, versioned paths, error mapping,
 * limited retries, and per-request correlation IDs for --debug tracing.
 */
export class RavenApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token?: string,
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    return this.request<AuthResult>('/v1/auth/register', { method: 'POST', body: { email, password } });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    return this.request<AuthResult>('/v1/auth/login', { method: 'POST', body: { email, password } });
  }

  async logout(): Promise<void> {
    await this.request<void>('/v1/auth/logout', { method: 'POST' });
  }

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/v1/projects');
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/v1/projects/${projectId}`);
  }

  async createProject(input: { name: string; description?: string }): Promise<Project> {
    return this.request<Project>('/v1/projects', { method: 'POST', body: input });
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request<void>(`/v1/projects/${projectId}`, { method: 'DELETE' });
  }

  async listApiKeys(projectId: string): Promise<ApiKeySummary[]> {
    return this.request<ApiKeySummary[]>(`/v1/projects/${projectId}/api-keys`);
  }

  async createApiKey(projectId: string, input: { name?: string }): Promise<CreatedApiKey> {
    return this.request<CreatedApiKey>(`/v1/projects/${projectId}/api-keys`, { method: 'POST', body: input });
  }

  async revokeApiKey(projectId: string, keyId: string): Promise<void> {
    await this.request<void>(`/v1/projects/${projectId}/api-keys/${keyId}`, { method: 'DELETE' });
  }

  async listRooms(projectId: string): Promise<RoomWithLiveState[]> {
    return this.request<RoomWithLiveState[]>(`/v1/projects/${projectId}/rooms`);
  }

  async getRoom(projectId: string, roomId: string): Promise<RoomDetailWithLiveState> {
    return this.request<RoomDetailWithLiveState>(`/v1/projects/${projectId}/rooms/${roomId}`);
  }

  async createRoom(projectId: string, name: string): Promise<RoomWithLiveState> {
    return this.request<RoomWithLiveState>(`/v1/projects/${projectId}/rooms`, { method: 'POST', body: { name } });
  }

  async createTestToken(projectId: string, roomId: string, participantIdentity?: string): Promise<IssuedRtcToken> {
    return this.request<IssuedRtcToken>(`/v1/projects/${projectId}/rooms/${roomId}/test-token`, {
      method: 'POST',
      body: { participantIdentity },
    });
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', {
      retryable: false,
      isSuccess: (status) => status === 200 || status === 503,
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const requestId = randomUUID();
    const method = options.method ?? 'GET';
    const url = `${this.apiUrl}${path}`;
    const retryable = options.retryable ?? true;

    let attempt = 0;
    while (true) {
      debugLog(`→ ${method} ${path}`, { requestId, body: options.body });

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new CliError('network', `Could not reach the Raven API at ${this.apiUrl}.`, {
          suggestion: 'Check your network connection and `raven config get apiUrl`',
          cause: error,
        });
      }

      debugLog(`← ${response.status} ${method} ${path}`, { requestId });

      if (response.status === 204) return undefined as T;

      const payload = await response.json().catch(() => undefined);
      const isSuccess = options.isSuccess ?? ((status: number) => status >= 200 && status < 300);

      if (isSuccess(response.status)) return payload as T;

      // 5xx is the only class worth retrying — 4xx errors are never transient.
      if (retryable && response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
        attempt++;
        continue;
      }

      throw mapErrorResponse(response.status, payload);
    }
  }
}

function mapErrorResponse(status: number, payload: unknown): CliError {
  const message = extractMessage(payload) ?? `Request failed with status ${status}`;

  if (status === 401) {
    return new CliError('auth', message, { suggestion: 'Run `raven login`' });
  }
  if (status === 403) {
    return new CliError('authz', message);
  }
  if (status === 404) {
    return new CliError('not_found', message);
  }
  if (status === 429) {
    return new CliError('network', 'Rate limit exceeded — try again shortly.');
  }
  if (status >= 500) {
    return new CliError('network', message, { suggestion: 'Try again in a moment' });
  }
  return new CliError('usage', message);
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const message = (payload as Record<string, unknown>).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
