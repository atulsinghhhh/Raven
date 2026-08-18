import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { ApiKeysService } from '../api-keys.service';

declare module 'express' {
  interface Request {
    apiProjectId?: string;
  }
}

/**
 * Authenticates machine-to-machine requests (Rooms, RTC Tokens) using a
 * project-scoped API key, as opposed to JwtAuthGuard which authenticates a
 * logged-in developer for dashboard-style management (Projects, API Keys).
 * See docs/control-plane.md#authentication-model.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing API key');
    }

    const project = await this.apiKeysService.verify(header.slice('Bearer '.length));
    request.apiProjectId = project.id;
    return true;
  }
}
