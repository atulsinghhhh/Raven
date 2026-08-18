import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ConflictError, UnauthorizedError } from '../../shared/errors/app-error';
import { RedisService } from '../../shared/redis/redis.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let redisService: { client: { set: jest.Mock; get: jest.Mock } };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    const configService = {
      get: jest.fn((key: string) => (key === 'jwt.expiresIn' ? '12h' : undefined)),
    } as unknown as ConfigService;

    redisService = { client: { set: jest.fn(), get: jest.fn() } };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      redisService as unknown as RedisService,
    );
  });

  describe('register', () => {
    it('rejects a duplicate email with ConflictError', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'u1' } as never);

      await expect(
        authService.register({ email: 'dev@raven.local', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('hashes the password before persisting — never stores it raw', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation((data) =>
        Promise.resolve({ id: 'u1', email: data.email, passwordHash: data.passwordHash, name: data.name ?? null } as never),
      );

      await authService.register({ email: 'dev@raven.local', password: 'password123' });

      const [{ passwordHash }] = usersService.create.mock.calls[0];
      expect(passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', passwordHash)).toBe(true);
    });
  });

  describe('login', () => {
    it('rejects an unknown email with UnauthorizedError (not a 404)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'ghost@raven.local', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects a wrong password with the same UnauthorizedError as unknown email', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash,
        name: null,
      } as never);

      await expect(
        authService.login({ email: 'dev@raven.local', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('succeeds and issues a token for a correct password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'dev@raven.local',
        passwordHash,
        name: null,
      } as never);

      const result = await authService.login({ email: 'dev@raven.local', password: 'correct-password' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({ id: 'u1', email: 'dev@raven.local', name: null });
    });
  });

  describe('logout', () => {
    it('blocklists the token jti in Redis with a TTL matching its remaining lifetime', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      await authService.logout({ id: 'u1', email: 'dev@raven.local', jti: 'jti-1', exp: nowSeconds + 100 });

      expect(redisService.client.set).toHaveBeenCalledWith(
        'auth:revoked-jti:jti-1',
        '1',
        'EX',
        expect.any(Number),
      );
      const ttl = redisService.client.set.mock.calls[0][3];
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    });
  });

  describe('isRevoked', () => {
    it('returns true only when the jti is present in Redis', async () => {
      redisService.client.get.mockResolvedValueOnce('1').mockResolvedValueOnce(null);

      await expect(authService.isRevoked('revoked-jti')).resolves.toBe(true);
      await expect(authService.isRevoked('active-jti')).resolves.toBe(false);
    });
  });
});
