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
 * Raven's server SDK. For your backend only; never a browser bundle.
 *
 * Authenticates with a permanent project API key. Never expose that key,
 * or an instance of this class, to a browser (Phase 10 spec §2).
 *
 * ```ts
 * import { Raven } from '@corvidhq/server';
 * const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });
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
  /** Raven Chat (Phase 12): mint browser tokens, manage conversations, post server-side messages. */
  readonly chat: ChatResource;
  /** Raven Live Streaming (Phase 14): create streams, register hosts, mint viewer credentials. */
  readonly liveStreams: LiveStreamsResource;

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
  }
}
