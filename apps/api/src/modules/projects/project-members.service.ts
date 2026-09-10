import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { EmailType } from '../email/email.constants';
import { EmailService } from '../email/email.service';
import { renderProjectMemberAddedEmail } from '../email/templates';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../shared/errors/app-error';
import { Capability, ProjectRole, canAssignRole, capabilitiesFor } from './project-permissions';
import { ProjectsService } from './projects.service';

export interface ProjectMemberView {
  userId: string;
  email: string;
  name: string | null;
  role: ProjectRole;
  capabilities: readonly Capability[];
  invitedById: string | null;
  createdAt: Date;
}

@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly emailService: EmailService,
  ) {}

  async list(projectId: string, actorId: string): Promise<ProjectMemberView[]> {
    await this.projects.authorize(projectId, actorId, Capability.MembersRead);

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      // Sent so a dashboard can hide what a member cannot do rather than
      // re-deriving the same table in the front end and letting the two drift.
      capabilities: capabilitiesFor(member.role),
      invitedById: member.invitedById,
      createdAt: member.createdAt,
    }));
  }

  async add(
    projectId: string,
    actorId: string,
    input: { email: string; role: ProjectRole },
  ): Promise<ProjectMemberView> {
    const { role: actorRole } = await this.projects.authorize(
      projectId,
      actorId,
      Capability.MembersManage,
    );

    if (!canAssignRole(actorRole, input.role)) {
      throw new ForbiddenError('Only an owner can grant the owner role');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true, email: true, name: true },
    });

    // No invitation flow yet, so the person must already have an account.
    // Saying so plainly beats a silent no-op or a pending row that never
    // resolves into anything.
    if (!user) {
      throw new NotFoundError(`No Livqeno account for ${input.email}`);
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictError(`${input.email} is already a member of this project`);
    }

    const member = await this.prisma.projectMember.create({
      data: { projectId, userId: user.id, role: input.role, invitedById: actorId },
    });

    await this.notifyMemberAdded(projectId, actorId, {
      email: user.email,
      name: user.name,
      role: input.role,
    });

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: member.role,
      capabilities: capabilitiesFor(member.role),
      invitedById: member.invitedById,
      createdAt: member.createdAt,
    };
  }

  async updateRole(
    projectId: string,
    actorId: string,
    targetUserId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberView> {
    const { role: actorRole } = await this.projects.authorize(
      projectId,
      actorId,
      Capability.MembersManage,
    );

    const target = await this.requireMember(projectId, targetUserId);

    // Both directions matter: granting owner, and taking it away.
    if (!canAssignRole(actorRole, role) || !canAssignRole(actorRole, target.role)) {
      throw new ForbiddenError('Only an owner can change an owner’s role');
    }

    if (target.role === ProjectRole.OWNER && role !== ProjectRole.OWNER) {
      await this.assertNotLastOwner(projectId, targetUserId);
    }

    const updated = await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      data: { role },
      include: { user: { select: { email: true, name: true } } },
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      capabilities: capabilitiesFor(updated.role),
      invitedById: updated.invitedById,
      createdAt: updated.createdAt,
    };
  }

  async remove(projectId: string, actorId: string, targetUserId: string): Promise<void> {
    const { role: actorRole } = await this.projects.authorize(
      projectId,
      actorId,
      Capability.MembersManage,
    );

    const target = await this.requireMember(projectId, targetUserId);

    if (!canAssignRole(actorRole, target.role)) {
      throw new ForbiddenError('Only an owner can remove an owner');
    }

    if (target.role === ProjectRole.OWNER) {
      await this.assertNotLastOwner(projectId, targetUserId);
    }

    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
  }

  /**
   * Tells someone they now have access to a project they did not create.
   *
   * Not an invitation: `add()` above requires an existing account, so
   * there is nothing to accept. The email says so, instead of implying a
   * pending state that has no endpoint behind it.
   *
   * Failure here never fails the membership: the row is already written
   * and the person already has access, so throwing would report a
   * completed action as broken. It is logged instead.
   */
  private async notifyMemberAdded(
    projectId: string,
    actorId: string,
    target: { email: string; name: string | null; role: ProjectRole },
  ): Promise<void> {
    try {
      const [project, actor] = await Promise.all([
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
        this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }),
      ]);

      if (!project || !actor) {
        return;
      }

      const result = await this.emailService.send({
        to: target.email,
        type: EmailType.ProjectMemberAdded,
        email: renderProjectMemberAddedEmail({
          name: target.name,
          projectName: project.name,
          // A name if they set one; otherwise the address, which is what
          // the recipient would recognise anyway.
          invitedBy: actor.name ?? actor.email,
          role: target.role,
          brand: this.emailService.brand,
        }),
      });

      if (result.status !== 'sent') {
        this.logger.warn(
          `member-added email not sent status=${result.status} projectId=${projectId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`member-added email failed: ${(err as Error).message}`);
    }
  }

  private async requireMember(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) {
      throw new NotFoundError('Project member');
    }
    return member;
  }

  /**
   * A project with no owner cannot be administered by anyone: not even to
   * appoint a new owner, so the last one is not removable or demotable.
   * The check counts other owners, not trusting the caller not to
   * be looking at a stale members list.
   */
  private async assertNotLastOwner(projectId: string, userId: string): Promise<void> {
    const otherOwners = await this.prisma.projectMember.count({
      where: { projectId, role: ProjectRole.OWNER, userId: { not: userId } },
    });

    if (otherOwners === 0) {
      throw new ValidationFailedError(
        'This is the project’s only owner. Promote someone else to owner first.',
      );
    }
  }
}
