import { Injectable } from '@nestjs/common';
import { User } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { UnauthorizedError } from '../../shared/errors/app-error';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** What GET /v1/users/me returns. Everything in here is safe to show the
 *  account holder; nothing in here is a credential. */
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** False for OAuth-only accounts — account settings uses it to offer
   *  "set a password" instead of "change password". */
  hasPassword: boolean;
  createdAt: Date;
  authAccounts: Array<{ provider: string; email: string | null; createdAt: Date }>;
  onboarding: { completed: boolean; step: number };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; passwordHash: string; name?: string }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  /**
   * Idempotent: the conditional `updateMany` only stamps an account that
   * has not been verified yet, so clicking a link twice keeps the original
   * timestamp instead of quietly rewriting when it happened.
   *
   * `newlyVerified` is what tells the caller whether to send the welcome
   * email: the second click must not produce a second welcome.
   */
  async markEmailVerified(id: string): Promise<{ user: User; newlyVerified: boolean }> {
    const { count } = await this.prisma.user.updateMany({
      where: { id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return { user, newlyVerified: count === 1 };
  }

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async getProfile(id: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        authAccounts: {
          select: { provider: true, email: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        onboarding: { select: { step: true, completedAt: true } },
      },
    });
    // A valid JWT for a deleted account: the session outlived the user.
    if (!user) {
      throw new UnauthorizedError();
    }
    return this.toProfile(user);
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserProfile> {
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.prisma.user.update({ where: { id }, data: { name: name || null } });
    }
    return this.getProfile(id);
  }

  private toProfile(
    user: User & {
      authAccounts: Array<{ provider: string; email: string | null; createdAt: Date }>;
      onboarding: { step: number; completedAt: Date | null } | null;
    },
  ): UserProfile {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerifiedAt),
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt,
      authAccounts: user.authAccounts,
      onboarding: {
        completed: Boolean(user.onboarding?.completedAt),
        step: user.onboarding?.step ?? 1,
      },
    };
  }
}
