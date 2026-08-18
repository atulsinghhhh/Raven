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
}
