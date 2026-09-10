import { RavenHttpClient, type RavenClientOptions } from './http-client';
import { ChatResource } from './resources/chat';
import { ConnectionsResource } from './resources/connections';
import { DiagnosticsResource } from './resources/diagnostics';
import { ErrorsResource } from './resources/errors-resource';
import { LiveStreamsResource } from './resources/live-streams';
import { MetricsResource } from './resources/metrics';
import { ProjectsResource } from './resources/projects';
import { RoomsResource } from './resources/rooms';
import { TokensResource } from './resources/tokens';

/**
 * Livqeno's server SDK. For your backend only; never a browser bundle.
 *
 * Authenticates with a permanent project API key. Never expose that key,
 * or an instance of this class, to a browser (Phase 10 spec §2).
 *
 * ```ts
 * import { Livqeno } from '@ravenkash/server';
 * const raven = new Raven({
 *   apiKey: process.env.RAVEN_API_KEY!,
 *   baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
 * });
 * const token = await raven.tokens.create({ room: roomId, identity: 'user-42' });
 * ```
 */
export class Raven {
  readonly projects: ProjectsResource;
  readonly tokens: TokensResource;
  readonly rooms: RoomsResource;
  readonly connections: ConnectionsResource;
  readonly errors: ErrorsResource;
  readonly metrics: MetricsResource;
  readonly diagnostics: DiagnosticsResource;
  /** Livqeno Chat (Phase 12): mint browser tokens, manage conversations, post server-side messages. */
  readonly chat: ChatResource;
  /** Livqeno Live Streaming (Phase 14): create streams, register hosts, mint viewer credentials. */
  readonly liveStreams: LiveStreamsResource;
  /**
   * `liveStreams` under the shorter name, so the three product surfaces read
   * alike: `raven.chat`, `raven.live`, `raven.rooms`.
   *
   * The same object, not a wrapper — `raven.live === raven.liveStreams`, so
   * there is no second implementation to keep in step and no behaviour that
   * differs between the two spellings. `liveStreams` is the original public
   * name and keeps working; nothing is deprecated.
   */
  readonly live: LiveStreamsResource;

  constructor(options: RavenClientOptions) {
    const http = new RavenHttpClient(options);
    this.projects = new ProjectsResource(http);
    this.tokens = new TokensResource(http);
    this.rooms = new RoomsResource(http);
    this.connections = new ConnectionsResource(http);
    this.errors = new ErrorsResource(http);
    this.metrics = new MetricsResource(http);
    this.diagnostics = new DiagnosticsResource(http);
    this.chat = new ChatResource(http);
    this.liveStreams = new LiveStreamsResource(http);
    this.live = this.liveStreams;
  }
}
