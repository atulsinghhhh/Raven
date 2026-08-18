import { WebSocket } from 'ws';
import { ChatScope } from '../chat-permissions';
import { Environment } from '../../../shared/environment/environment.constants';

/** One conversation this socket is subscribed to, plus how to stop listening. */
export interface RoomSubscription {
  conversationId: string;
  conversationPublicId: string;
  /** Releases this gateway's Redis pub/sub reference for the conversation. */
  unsubscribe: () => Promise<void>;
}

/**
 * One authenticated chat WebSocket. Identity comes from the token, not
 * the connection — a reconnect produces a new `connectionId` but is still
 * the same `userId`, which is why presence survives a reconnect and read
 * state doesn't reset.
 */
export interface ChatSession {
  /** `ccn_...`, surfaced in the dashboard and in every log line for this socket. */
  connectionId: string;
  /** Database row id for the ChatConnection record, so disconnect can close it out. */
  connectionRowId?: string;
  projectId: string;
  /** From the token's signed `env` claim — a socket cannot change environment. */
  environment: Environment;
  userId: string;
  scopes: ChatScope[];
  tokenId: string;
  /** Epoch ms. The socket is closed when the token behind it expires (spec §39). */
  tokenExpiresAt: number;
  /** Conversations the token is pinned to; empty means "any the user belongs to". */
  conversationScope: string[];
  socket: WebSocket;
  /** conversationId -> subscription. A socket may hold several rooms at once. */
  rooms: Map<string, RoomSubscription>;
  /** Flipped false before each ping; a pong flips it back. Two misses and the socket dies. */
  isAlive: boolean;
  connectedAt: Date;
  messagesSent: number;
}
