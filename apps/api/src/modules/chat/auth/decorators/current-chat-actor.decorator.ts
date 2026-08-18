import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { ChatActor } from '../chat-actor.interface';

/**
 * The actor ChatAuthGuard resolved for this request. Controllers take
 * this instead of reading identity out of the body — which is what makes
 * "never trust client-provided sender_id" (spec §39) structural rather
 * than a rule everyone has to remember.
 */
export const CurrentChatActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): ChatActor => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.chatActor!;
});
