import { ChatMemberRole } from '../../../generated/prisma/client';
import { Environment } from '../../../shared/environment/environment.constants';
import { ChatActor } from '../auth/chat-actor.interface';
import { CHAT_SCOPES } from '../chat-permissions';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatTokenService } from '../tokens/chat-token.service';
import { ChatController } from './chat.controller';

/**
 * `POST /v1/chat/tokens` specifically: which conversation identifier the
 * response carries, and whether it says anything about a user who is not
 * a member yet.
 *
 * Both were reported by an external integrator, and both cost real time
 * to diagnose because the failure surfaced one call later as
 * `RAVEN_CONVERSATION_NOT_FOUND` for a conversation that demonstrably
 * existed.
 */
describe('ChatController — POST /v1/chat/tokens', () => {
  const SERVER_ACTOR: ChatActor = {
    kind: 'server',
    projectId: 'p1',
    environment: Environment.DEVELOPMENT,
    userId: null,
    scopes: [...CHAT_SCOPES],
  };

  const CONVERSATION = {
    id: 'a03feb84-6d83-410d-b8db-3a1a3054362f',
    publicId: 'conv_LxHO3BNYfAD8CNO8C4K_Cw',
  };

  let conversations: { resolve: jest.Mock; rolesFor: jest.Mock };
  let chatTokens: { issue: jest.Mock };
  let controller: ChatController;

  /** What `issue()` was called with, for asserting on the signed scope. */
  const issuedWith = () => chatTokens.issue.mock.calls[0][0];

  beforeEach(() => {
    conversations = {
      resolve: jest.fn().mockResolvedValue(CONVERSATION),
      rolesFor: jest.fn().mockResolvedValue(new Map()),
    };
    chatTokens = {
      issue: jest.fn((input: { conversations: string[] }) => ({
        token: 'signed',
        tokenId: 'ctk_1',
        userId: 'alice',
        conversations: input.conversations,
      })),
    };

    // Only the two collaborators the mint path touches are real; the
    // rest of the constructor belongs to endpoints this file does not
    // exercise, and stubbing them would be scenery.
    const unused = undefined as never;
    controller = new ChatController(
      conversations as unknown as ConversationsService,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      chatTokens as unknown as ChatTokenService,
    );
  });

  it('REGRESSION: echoes the public id, not the internal uuid', async () => {
    const response = await controller.createToken(SERVER_ACTOR, {
      userId: 'alice',
      conversations: [CONVERSATION.publicId],
    });

    // The uuid authorizes too, but it is not an identifier a developer
    // holds anywhere else: feeding it back to connect() or to a REST
    // path is what produced the phantom 404.
    expect(response.conversations).toEqual([CONVERSATION.publicId]);
    expect(issuedWith().conversations).toEqual([CONVERSATION.publicId]);
  });

  it('REGRESSION: names conversations the user is not a member of yet', async () => {
    const response = await controller.createToken(SERVER_ACTOR, {
      userId: 'alice',
      conversations: [CONVERSATION.publicId],
    });

    // Still minted — either ordering is supported on purpose — but no
    // longer silent about the read that is about to 404.
    expect(response.token).toBe('signed');
    expect(response.pendingMembership).toEqual([CONVERSATION.publicId]);
  });

  it('reports nothing pending for a member, and signs their real role', async () => {
    conversations.rolesFor.mockResolvedValue(new Map([[CONVERSATION.id, ChatMemberRole.ADMIN]]));

    const response = await controller.createToken(SERVER_ACTOR, {
      userId: 'alice',
      conversations: [CONVERSATION.publicId],
    });

    expect(response.pendingMembership).toEqual([]);
    expect(issuedWith().role).toBe(ChatMemberRole.ADMIN);
  });

  it('lists only the conversations actually missing a membership', async () => {
    const other = { id: 'uuid-2', publicId: 'conv_second' };
    conversations.resolve.mockResolvedValueOnce(CONVERSATION).mockResolvedValueOnce(other);
    conversations.rolesFor.mockResolvedValue(new Map([[CONVERSATION.id, ChatMemberRole.MEMBER]]));

    const response = await controller.createToken(SERVER_ACTOR, {
      userId: 'alice',
      conversations: [CONVERSATION.publicId, other.publicId],
    });

    expect(response.pendingMembership).toEqual([other.publicId]);
  });

  it('mints an unscoped token with nothing pending', async () => {
    const response = await controller.createToken(SERVER_ACTOR, { userId: 'alice' });

    // No conversations requested means "every conversation this user
    // belongs to", so there is nothing here to be missing a membership in.
    expect(response.pendingMembership).toEqual([]);
    expect(conversations.resolve).not.toHaveBeenCalled();
    expect(issuedWith().role).toBe(ChatMemberRole.MEMBER);
  });
});
