import type { RavenHttpClient } from '../http-client';
import type { MetricsOverview, MetricsRange } from '../types';

/**
 * Real-only aggregate metrics (Phase 9) — this is also today's "usage"
 * view (no separate billing/usage-metering system exists yet, see
 * docs/sdk/server/typescript.md#usage).
 */
export class MetricsResource {
  constructor(private readonly http: RavenHttpClient) {}

  get(range?: MetricsRange): Promise<MetricsOverview> {
    return this.http.request<MetricsOverview>('/v1/metrics', { query: { range } });
  }
}
