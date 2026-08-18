import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { AuthService } from '../auth.service';
import { AuthenticatedUser, JwtPayload } from '../jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (await this.authService.isRevoked(payload.jti)) {
      throw new UnauthorizedError('Token has been revoked');
    }

    return { id: payload.sub, email: payload.email, jti: payload.jti, exp: payload.exp! };
  }
}
