import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { CHAT_SCOPES, ChatScope } from '../chat-permissions';
import { ChatTokenService } from '../tokens/chat-token.service';
import { ChatActor } from './chat-actor.interface';
import { DEFAULT_ENVIRONMENT } from '../../../shared/environment/environment.constants';

declare module 'express' {
  interface Request {
    chatActor?: ChatActor;
  }
}

/**
 * One guard, two credentials — because the chat REST surface has to serve
 * both a developer's backend and their users' browsers, and duplicating
 * every endpoint per credential type would double the API for no gain.
 *
 * A `Bearer rvk_....secret` (project API key) resolves to a **server**
 * actor: full scopes, may act on behalf of any user in its project.
 * Anything else is tried as a short-lived chat token and resolves to a
 * **client** actor: identity and scopes come from the signature, and the
 * request body can't widen either.
 *
 * The distinction is enforced downstream in resolveSubjectId() — this
 * guard's only job is to say truthfully which one showed up.
 */
@Injectable()
export class ChatAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly chatTokenService: ChatTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing credentials — send a project API key or a chat token');
    }

    const credential = header.slice('Bearer '.length).trim();

    // API keys are `publicId.secret` with a known prefix, so this is a
    // shape check, not a guess — no chance of feeding a chat token into
    // the API-key verifier or vice versa.
    if (credential.startsWith('rvk_')) {
      const { project, environment } = await this.apiKeysService.verify(credential);
      request.chatActor = {
        kind: 'server',
        projectId: project.id,
        environment,
        userId: null,
        scopes: [...CHAT_SCOPES],
      };
      return true;
    }

    const claims = await this.chatTokenService.verify(credential);
    request.chatActor = {
      kind: 'client',
      projectId: claims.pid,
      // Tokens minted before environments existed carry no claim; they
      // resolve to development, which is where they were being used.
      environment: claims.env ?? DEFAULT_ENVIRONMENT,
      userId: claims.sub,
      scopes: claims.scopes as ChatScope[],
      tokenId: claims.jti,
      conversationScope: claims.cvs,
    };
    return true;
  }
}
