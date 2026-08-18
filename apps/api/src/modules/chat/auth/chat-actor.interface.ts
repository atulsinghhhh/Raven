import { ChatScope } from '../chat-permissions';

/**
 * Who is making a chat request. Both the HTTP controllers and the
 * WebSocket gateway resolve one of these before touching a service, so
 * every service takes an actor rather than a loose `userId` string it
 * would have to trust.
 *
 * The distinction that matters: a `server` actor authenticated with a
 * project API key may act *on behalf of* any user in its project (that's
 * how a developer's own backend posts a system message). A `client`
 * actor authenticated with a short-lived chat token may only ever act as
 * itself — `userId` comes from the signed token and is never overridable
 * from the request body (spec §39).
 */
export interface ChatActor {
  kind: 'server' | 'client';
  projectId: string;
  /** Null only for a server actor that hasn't named a user to act as. */
  userId: string | null;
  scopes: ChatScope[];
  /** Chat-token id, for revocation and audit. Absent for server actors. */
  tokenId?: string;
  /** Conversations a client token is pinned to. Empty = project-wide (server actors). */
  conversationScope?: string[];
}

/** True when this actor is allowed to name a different user as the sender. */
export function canImpersonate(actor: ChatActor): boolean {
  return actor.kind === 'server';
}

/**
 * The identity a write should be attributed to. A client actor's request
 * body is ignored entirely here — that's the single chokepoint stopping a
 * browser from forging `senderId`.
 */
export function resolveSubjectId(actor: ChatActor, requested?: string | null): string | null {
  if (actor.kind === 'client') {
    return actor.userId;
  }
  return requested ?? actor.userId;
}
