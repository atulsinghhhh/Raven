import type { RavenHttpClient } from '../http-client';
import type { Project } from '../types';

/**
 * An API key is already permanently scoped to exactly one project (Phase
 * 10 spec §2/§14) — there is nothing to list/create/update/delete here.
 * Those remain human/dashboard-session operations, not something a
 * server API key can or should do. `get()` takes no arguments: it always
 * returns the one project this key belongs to.
 */
export class ProjectsResource {
  constructor(private readonly http: RavenHttpClient) {}

  /** Returns the project this API key belongs to. */
  get(): Promise<Project> {
    return this.http.request<Project>('/v1/project');
  }
}
