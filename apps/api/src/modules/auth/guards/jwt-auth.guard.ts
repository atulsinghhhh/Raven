import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protects developer/dashboard-facing endpoints (Projects, API Keys management). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
