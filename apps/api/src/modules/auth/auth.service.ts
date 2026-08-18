import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ConflictError, UnauthorizedError } from '../../shared/errors/app-error';
import { RedisService } from '../../shared/redis/redis.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser, JwtPayload } from './jwt-payload.interface';

const PASSWORD_SALT_ROUNDS = 12;
const REVOCATION_KEY_PREFIX = 'auth:revoked-jti:';

export interface AuthResult {
  accessToken: string;
  expiresIn: string;
  user: { id: string; email: string; name: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
    });

    return this.issueToken(user.id, user.email, user.name);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }

    return this.issueToken(user.id, user.email, user.name);
  }

  /**
   * JWTs are stateless, so there's nothing to delete on logout. We just
   * blocklist this token's jti in Redis until its natural expiry — cheap,
   * bounded, no DB write per request like a real session store would need.
   */
  async logout(user: AuthenticatedUser): Promise<void> {
    const ttlSeconds = Math.max(user.exp - Math.floor(Date.now() / 1000), 1);
    await this.redisService.client.set(
      `${REVOCATION_KEY_PREFIX}${user.jti}`,
      '1',
      'EX',
      ttlSeconds,
    );
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redisService.client.get(`${REVOCATION_KEY_PREFIX}${jti}`);
    return value !== null;
  }

  private async issueToken(
    userId: string,
    email: string,
    name: string | null,
  ): Promise<AuthResult> {
    const payload: JwtPayload = { sub: userId, email, jti: randomUUID() };
    const expiresIn = this.configService.get<string>('jwt.expiresIn')!;
    const accessToken = this.jwtService.sign(payload, { expiresIn });

    return { accessToken, expiresIn, user: { id: userId, email, name } };
  }
}
