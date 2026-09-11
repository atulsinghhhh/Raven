import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { Environment } from '../../../shared/environment/environment.constants';
import { ApiKeysService } from '../api-keys.service';

declare module 'express' {
  interface Request {
    apiProjectId?: string;
    apiEnvironment?: Environment;
    /** The authenticating key's own public id: see RateLimitGuard for why
     *  this, and not apiProjectId, is what rate limiting keys on. */
    apiKeyPublicId?: string;
  }
}

// Authenticates machine-to-machine requests (Rooms, RTC Tokens) with a
// project-scoped API key. JwtAuthGuard is the other one, for a logged-in
// developer doing dashboard-style management (Projects, API Keys).
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing API key');
    }

    const { project, environment, publicId } = await this.apiKeysService.verify(header.slice('Bearer '.length));
    request.apiProjectId = project.id;
    request.apiEnvironment = environment;
    request.apiKeyPublicId = publicId;
    return true;
  }
}
