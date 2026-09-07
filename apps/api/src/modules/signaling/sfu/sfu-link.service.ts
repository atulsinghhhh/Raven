import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawData, WebSocket } from 'ws';
import { RtcServer } from '../../../generated/prisma/client';
import { NodeLinkFrame, NodeLinkMessageType } from './node-link.interface';

/**
 * How long to wait for a link to open before giving up on this attempt.
 * A join is blocked behind it, so it cannot be generous.
 */
const CONNECT_TIMEOUT_MS = 5_000;

/** Backoff bounds for reconnecting a dropped link. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * How often live sessions are re-announced to their node.
 *
 * Sessions on an SFU belong to the link that created them. Negotiation
 * traffic re-binds ownership on its own, but a settled call sends nothing
 * for minutes at a time — so an idle session would stay orphaned after a
 * link reconnect until the node swept it. This is the cheap fix.
 */
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * How long a room-state query waits for its reply.
 *
 * Short, because a dashboard request is blocked behind it and a stale
 * "unknown" is a better answer than a hanging page. The caller reports
 * `null` on timeout, which the UI renders as "unknown" rather than zero.
 */
const REQUEST_TIMEOUT_MS = 3_000;

export type FrameHandler = (frame: NodeLinkFrame) => void;

interface NodeLink {
  serverId: string;
  serverName: string;
  socket: WebSocket;
  closing: boolean;
}

/**
 * Maintains this API instance's WebSocket to each RTC server it has
 * participants on.
 *
 * # Why per-instance rather than one link for the fleet
 *
 * A client's signaling WebSocket lands on one API instance, and that
 * instance is the only one that can deliver an offer to that client. So
 * that instance holds the link carrying its sessions' frames. The
 * alternative — one elected link holder for the fleet — would route every
 * SDP and ICE message through Redis to find the instance with the socket,
 * adding a hop to the latency-sensitive part of joining a call.
 *
 * The SFU side accepts several links and remembers which one owns each
 * session; see `services/sfu/internal/signal/server.go`.
 *
 * # What this service is not
 *
 * It is not a place where signaling decisions are made. It opens links,
 * writes frames, reads frames, and hands them to a single registered
 * handler. Everything about rooms, permissions, and participants lives in
 * the router.
 */
@Injectable()
export class SfuLinkService implements OnModuleDestroy {
  private readonly logger = new Logger(SfuLinkService.name);
  private readonly links = new Map<string, NodeLink>(); // by server id
  /**
   * Sessions this instance holds on each node, kept outside the link
   * object so it survives a link dropping and reconnecting — that set is
   * exactly what a reconnect needs in order to re-claim its sessions.
   */
  private readonly sessionsByServer = new Map<string, Map<string, string>>(); // serverId → (sessionId → roomId)
  private readonly reconnectAttempts = new Map<string, number>();
  /** In-flight connection attempts, so concurrent joins share one dial. */
  private readonly connecting = new Map<string, Promise<NodeLink>>();
  private frameHandler?: FrameHandler;
  /** In-flight queries, by correlation id. */
  private readonly pendingRequests = new Map<
    string,
    { resolve: (frame: NodeLinkFrame) => void; timer: NodeJS.Timeout }
  >();
  private requestCounter = 0;
  private keepaliveTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(private readonly configService: ConfigService) {
    this.keepaliveTimer = setInterval(() => this.sendKeepalives(), KEEPALIVE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
    }
    for (const link of this.links.values()) {
      link.closing = true;
      link.socket.close(1001, 'shutting down');
    }
    this.links.clear();
    this.sessionsByServer.clear();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
  }

  /**
   * Registers the single handler for inbound frames.
   *
   * One handler, not an event emitter with many listeners: every frame has
   * exactly one correct destination (the session it names), and a
   * fan-out here would make it possible to handle the same negotiation
   * frame twice.
   */
  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  /**
   * Sends a frame to the node serving this room, opening the link if
   * needed.
   *
   * Throws if the node cannot be reached. Callers on the join path turn
   * that into `RTC_SERVER_UNREACHABLE` for the client, which is
   * retryable — a client that cannot reach one node may be allocated a
   * different one on its next attempt.
   */
  async send(server: RtcServer, frame: NodeLinkFrame): Promise<void> {
    const link = await this.linkFor(server);

    if (frame.sessionId) {
      if (frame.type === NodeLinkMessageType.PARTICIPANT_ADD && frame.roomId) {
        this.sessionsFor(server.id).set(frame.sessionId, frame.roomId);
      } else if (frame.type === NodeLinkMessageType.PARTICIPANT_REMOVE) {
        this.sessionsFor(server.id).delete(frame.sessionId);
      }
    }

    if (link.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`node link to ${server.name} is not open`);
    }
    link.socket.send(JSON.stringify(frame));
  }

  /**
   * Best-effort send, for frames whose loss is not worth failing a caller
   * over — a mute, a subscription preference, a participant removal that
   * the node will clean up on its own when the PeerConnection dies.
   */
  async trySend(server: RtcServer, frame: NodeLinkFrame): Promise<boolean> {
    try {
      await this.send(server, frame);
      return true;
    } catch (err) {
      this.logger.warn(
        `dropping ${frame.type} for session ${frame.sessionId ?? '-'} — ${server.name} unreachable: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Sends a query and waits for its correlated reply.
   *
   * Resolves to `null` rather than throwing when the node is unreachable
   * or does not answer in time. Callers turn that into "unknown", which
   * is the honest thing for a dashboard to show — distinct from "zero
   * participants", which is a fact about an idle room.
   */
  async request(
    server: RtcServer,
    type: NodeLinkMessageType,
    roomId: string,
  ): Promise<NodeLinkFrame | null> {
    const requestId = `req-${++this.requestCounter}-${Date.now().toString(36)}`;

    const reply = new Promise<NodeLinkFrame | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.logger.warn(`query ${type} to ${server.name} timed out after ${REQUEST_TIMEOUT_MS}ms`);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(requestId, { resolve, timer });
    });

    try {
      await this.send(server, { type, roomId, requestId });
    } catch (err) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
      }
      this.logger.warn(
        `query ${type} could not be sent to ${server.name}: ${(err as Error).message}`,
      );
      return null;
    }

    return reply;
  }

  /** Forgets a session, so keepalives stop naming it. */
  releaseSession(sessionId: string): void {
    for (const sessions of this.sessionsByServer.values()) {
      sessions.delete(sessionId);
    }
  }

  private sessionsFor(serverId: string): Map<string, string> {
    let sessions = this.sessionsByServer.get(serverId);
    if (!sessions) {
      sessions = new Map();
      this.sessionsByServer.set(serverId, sessions);
    }
    return sessions;
  }

  private async linkFor(server: RtcServer): Promise<NodeLink> {
    const existing = this.links.get(server.id);
    if (existing && existing.socket.readyState === WebSocket.OPEN) {
      return existing;
    }

    // Several participants joining the same room at once would otherwise
    // each dial the node. Sharing the in-flight promise means one dial.
    const inFlight = this.connecting.get(server.id);
    if (inFlight) {
      return inFlight;
    }

    const attempt = this.connect(server).finally(() => this.connecting.delete(server.id));
    this.connecting.set(server.id, attempt);
    return attempt;
  }

  private connect(server: RtcServer): Promise<NodeLink> {
    const url = this.linkUrl(server);
    const secret = this.configService.get<string>('sfu.registrationSecret')!;

    return new Promise<NodeLink>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${secret}` },
        handshakeTimeout: CONNECT_TIMEOUT_MS,
      });

      const link: NodeLink = {
        serverId: server.id,
        serverName: server.name,
        socket,
        closing: false,
      };

      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`timed out opening node link to ${server.name}`));
      }, CONNECT_TIMEOUT_MS);

      socket.on('open', () => {
        clearTimeout(timeout);
        this.reconnectAttempts.delete(server.id);
        this.links.set(server.id, link);
        this.logger.log(`node link open: rtcServer=${server.name} region=${server.region}`);
        // Re-claim any sessions this instance still holds on the node —
        // after a reconnect they are orphaned there until something names
        // them again.
        this.reclaimSessions(link);
        resolve(link);
      });

      socket.on('message', (data: RawData) => this.handleMessage(link, data));

      socket.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.warn(`node link error: rtcServer=${server.name}: ${err.message}`);
        reject(err);
      });

      socket.on('close', (code, reason) => {
        clearTimeout(timeout);
        if (this.links.get(server.id) === link) {
          this.links.delete(server.id);
        }
        if (link.closing || this.destroyed) {
          return;
        }
        const sessions = this.sessionsFor(server.id);
        this.logger.warn(
          `node link closed: rtcServer=${server.name} code=${code} reason=${reason.toString() || 'none'} sessions=${sessions.size}`,
        );
        // Reconnect only while this instance still has sessions there.
        // Otherwise the link is re-opened lazily on the next join, and a
        // node that was drained or removed is not kept alive by a
        // reconnect loop that has nothing to carry.
        if (sessions.size > 0) {
          this.scheduleReconnect(server);
        }
      });
    });
  }

  private scheduleReconnect(server: RtcServer): void {
    const attempts = (this.reconnectAttempts.get(server.id) ?? 0) + 1;
    this.reconnectAttempts.set(server.id, attempts);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);

    this.logger.log(
      `reconnecting node link to ${server.name} in ${delay}ms (attempt ${attempts}, ${this.sessionsFor(server.id).size} sessions)`,
    );

    setTimeout(() => {
      if (this.destroyed || this.links.has(server.id)) {
        return;
      }
      if (this.sessionsFor(server.id).size === 0) {
        // Everyone left while we were waiting. Nothing to carry, so stop.
        this.reconnectAttempts.delete(server.id);
        return;
      }
      void this.linkFor(server).catch((err) => {
        this.logger.warn(`node link reconnect to ${server.name} failed: ${(err as Error).message}`);
        this.scheduleReconnect(server);
      });
    }, delay);
  }

  /**
   * Re-announces this instance's sessions after a link opens.
   *
   * Necessary because the node orphans a session when the link that owned
   * it drops, and sweeps it after a grace period. Naming the session again
   * is what re-binds ownership — the node treats any frame mentioning a
   * session as a claim on it.
   */
  private reclaimSessions(link: NodeLink): void {
    const sessions = this.sessionsFor(link.serverId);
    for (const [sessionId, roomId] of sessions) {
      this.sendKeepalive(link, sessionId, roomId);
    }
    if (sessions.size > 0) {
      this.logger.log(`re-claimed ${sessions.size} session(s) on ${link.serverName}`);
    }
  }

  private sendKeepalives(): void {
    for (const link of this.links.values()) {
      if (link.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      for (const [sessionId, roomId] of this.sessionsFor(link.serverId)) {
        this.sendKeepalive(link, sessionId, roomId);
      }
    }
  }

  private sendKeepalive(link: NodeLink, sessionId: string, roomId: string): void {
    const frame: NodeLinkFrame = {
      type: NodeLinkMessageType.SESSION_KEEPALIVE,
      sessionId,
      roomId,
    };
    link.socket.send(JSON.stringify(frame));
  }

  private handleMessage(link: NodeLink, data: RawData): void {
    let frame: NodeLinkFrame;
    try {
      frame = JSON.parse(data.toString()) as NodeLinkFrame;
    } catch {
      this.logger.warn(`unparseable frame from ${link.serverName}`);
      return;
    }

    // A correlated reply belongs to whoever is awaiting it, not to the
    // general frame handler.
    if (frame.requestId) {
      const pending = this.pendingRequests.get(frame.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(frame.requestId);
        pending.resolve(frame);
        return;
      }
      // Arrived after the timeout fired. Logged rather than silently
      // dropped: a node consistently answering slowly is worth seeing.
      this.logger.debug(`late reply for ${frame.requestId} from ${link.serverName}`);
      return;
    }

    if (!this.frameHandler) {
      this.logger.warn(`dropping ${frame.type} from ${link.serverName} — no handler registered`);
      return;
    }

    try {
      this.frameHandler(frame);
    } catch (err) {
      // One bad frame must not kill the link's read loop and with it every
      // call on that node.
      this.logger.error(
        `handling ${frame.type} from ${link.serverName} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The node link's URL, derived from the server's `internalUrl`.
   *
   * `internalUrl` is an HTTP base because that is what a registry row
   * naturally holds and what a health probe uses; the link is a WebSocket
   * on the same host. Deriving it here rather than storing a second
   * address keeps one thing for an operator to configure.
   */
  private linkUrl(server: RtcServer): string {
    const base = server.internalUrl.replace(/\/$/, '');
    const ws = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${ws}/internal/link`;
  }

  /** For /health and metrics: which nodes this instance is linked to. */
  getLinkedServers(): { name: string; sessions: number }[] {
    return Array.from(this.links.values()).map((link) => ({
      name: link.serverName,
      sessions: this.sessionsFor(link.serverId).size,
    }));
  }
}
