import type { RavenHttpClient } from '../http-client';
import type { ProjectDiagnostics } from '../types';

/**
 * Authenticated, project-scoped diagnostics (Phase 9) — signaling/SFU/
 * TURN health plus this project's real active-connection count. There is
 * no client-side (browser ICE/signaling state) diagnostic here — that
 * only exists inside a running `@raven/rtc` client (`room.getDiagnostics()`),
 * which a backend has no way to observe.
 */
export class DiagnosticsResource {
  constructor(private readonly http: RavenHttpClient) {}

  get(): Promise<ProjectDiagnostics> {
    return this.http.request<ProjectDiagnostics>('/v1/diagnostics');
  }
}
