import { Injectable } from '@nestjs/common';
import { User } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';

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
}
