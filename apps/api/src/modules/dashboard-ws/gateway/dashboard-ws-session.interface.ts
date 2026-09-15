import { WebSocket } from 'ws';

/** One authenticated dashboard realtime connection, held for its lifetime. */
export interface DashboardWsSession {
  connectionId: string;
  /** The only source of project scope for this connection — read once from the token's signed claim at connect time, never re-read from anything the client sends afterward. */
  projectId: string;
  userId: string;
  tokenId: string;
  tokenExpiresAt: number;
  socket: WebSocket;
  /** Releases this connection's hold on the project's Redis channel (DashboardEventsService.subscribe's ref-counted release). */
  unsubscribe: () => Promise<void>;
  isAlive: boolean;
  connectedAt: Date;
}
