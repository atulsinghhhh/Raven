import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ForbiddenError } from '../errors/app-error';
import type { VerifiedRtcToken } from '../../modules/signaling/authentication/rtc-token-verifier.service';
import { ProjectOriginService } from './project-origin.service';

type OriginCheckedRequest = Request & { rtcContext?: VerifiedRtcToken };

/**
 * Enforces a project's browser-origin allow-list on an SDK HTTP route.
 *
 * Runs **after** the route's authentication guard, and that ordering is the
 * whole point: the project comes from the verified credential, so a caller
 * cannot aim one tenant's allow-list at another tenant's data. List this
 * after `TelemetryIngestGuard` / `ChatAuthGuard` in `@UseGuards`, never
 * before.
 *
 * A disallowed origin gets a 403 that says so. That is deliberately not a
 * CORS rejection: a real CORS block is invisible to the page's JavaScript,
 * so a developer sees "blocked by CORS policy" and nothing to act on.
 * Cross-origin *reads* are governed by the permissive CORS headers on these
 * routes (see shared/config/cors-policy.ts); tenancy is governed here, in
 * the server, where the answer can be explained.
 */
@Injectable()
export class ProjectOriginGuard implements CanActivate {
  constructor(private readonly origins: ProjectOriginService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OriginCheckedRequest>();

    // Whichever credential the route authenticated with. Both carry the
    // project as a signed claim, never as request input.
    const projectId = request.rtcContext?.projectId ?? request.chatActor?.projectId;
    if (!projectId) {
      // No authenticated project means this guard was wired before the
      // auth guard, which would silently check nothing at all.
      throw new ForbiddenError('Origin policy could not be resolved for this request');
    }

    const origin = request.headers.origin;
    if (await this.origins.isAllowed(projectId, origin)) {
      return true;
    }

    throw new ForbiddenError(
      `Origin ${origin} is not allowed for this project. Add it under Project Settings, Security, Allowed Origins.`,
    );
  }
}
