import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformRole } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AdminAction, AdminTargetType } from '../admin-audit.constants';
import { AdminAuditService } from '../admin-audit.service';
import { AuthenticatedPlatformAdmin } from '../guards/platform-role.guard';
import { GrantAdminDto } from './dto/grant-admin.dto';

export interface PlatformAdminRow {
  id: string;
  email: string;
  name: string | null;
  platformRole: PlatformRole;
  createdAt: Date;
}

/**
 * Manages who holds a `PlatformRole` (spec §3/§9) — the single most
 * sensitive surface in this portal, since granting one is how a normal
 * developer account becomes a platform admin at all. Every mutation here
 * requires `SUPER_ADMIN` at the controller layer and writes an
 * `AdminAuditLog` entry; reads are open to any platform role.
 */
@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  async list(): Promise<PlatformAdminRow[]> {
    return this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: { id: true, email: true, name: true, platformRole: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }) as Promise<PlatformAdminRow[]>;
  }

  async grant(dto: GrantAdminDto, actingAdmin: AuthenticatedPlatformAdmin): Promise<PlatformAdminRow> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, name: true, platformRole: true, createdAt: true },
    });

    if (!user) {
      throw new NotFoundException(`No user found with email ${dto.email}`);
    }

    const beforeState = { platformRole: user.platformRole };
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { platformRole: dto.platformRole },
      select: { id: true, email: true, name: true, platformRole: true, createdAt: true },
    });

    await this.adminAudit.record({
      admin: { id: actingAdmin.id, email: actingAdmin.email },
      action: AdminAction.PlatformRoleGranted,
      targetType: AdminTargetType.PlatformAdmin,
      targetId: user.id,
      reason: dto.reason,
      beforeState,
      afterState: { platformRole: updated.platformRole },
    });

    return updated as PlatformAdminRow;
  }

  async revoke(userId: string, reason: string, actingAdmin: AuthenticatedPlatformAdmin): Promise<void> {
    // A SUPER_ADMIN locking themselves out is the one failure mode this
    // whole portal cannot recover from without direct database access —
    // there would be nobody left who could grant the role back. This
    // check is the entire reason that scenario can't happen through this
    // endpoint.
    if (userId === actingAdmin.id) {
      throw new ForbiddenException('You cannot revoke your own platform role.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, platformRole: true },
    });

    if (!user || !user.platformRole) {
      throw new NotFoundException('No platform admin found with this id');
    }

    const beforeState = { platformRole: user.platformRole };
    await this.prisma.user.update({ where: { id: userId }, data: { platformRole: null } });

    await this.adminAudit.record({
      admin: { id: actingAdmin.id, email: actingAdmin.email },
      action: AdminAction.PlatformRoleRevoked,
      targetType: AdminTargetType.PlatformAdmin,
      targetId: userId,
      reason,
      beforeState,
      afterState: { platformRole: null },
    });
  }
}
