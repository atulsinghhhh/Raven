import { Injectable } from '@nestjs/common';
import { Project, ProjectStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { Capability, ProjectRole, can } from './project-permissions';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/** A project the caller is allowed to touch, plus the role that allowed it. */
export interface AuthorizedProject {
  project: Project;
  role: ProjectRole;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateProjectDto): Promise<Project> {
    // The creator's OWNER membership is written in the same transaction as
    // the project. A project with no owner is unreachable, so these must
    // not be able to come apart.
    return this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        ownerId,
        members: { create: { userId: ownerId, role: ProjectRole.OWNER } },
      },
    });
  }

  /** Every project the user can reach, whatever their role in it. */
  findAllForUser(userId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { status: ProjectStatus.ACTIVE, members: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * No ownership check: safe only when the caller's authorization
   * already scopes them to exactly this project (e.g. `ApiKeyAuthGuard`,
   * which resolves `projectId` from the key itself, so there is no other
   * project this could ever resolve to). Never expose this to a route
   * that accepts an arbitrary caller-supplied project ID.
   */
  async findOneById(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundError('Project', RavenErrorCode.PROJECT_NOT_FOUND);
    }
    return project;
  }

  /**
   * The one authorization chokepoint for project-scoped routes.
   *
   * Two different answers on purpose:
   *
   * - Not a member at all → **404**, identical to a project that does not
   *   exist. A 403 would confirm the id is real and belongs to someone,
   *   which is what an attacker enumerating ids wants to learn.
   * - A member without the capability → **403**. They already know the
   *   project exists, so hiding it achieves nothing and a 404 would send
   *   them hunting for a bug instead of asking for access.
   */
  async authorize(
    projectId: string,
    userId: string,
    capability: Capability,
  ): Promise<AuthorizedProject> {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      include: { project: true },
    });

    if (!membership || membership.project.status !== ProjectStatus.ACTIVE) {
      throw new NotFoundError('Project', RavenErrorCode.PROJECT_NOT_FOUND);
    }

    if (!can(membership.role, capability)) {
      throw new ForbiddenError(
        `Your role in this project (${membership.role.toLowerCase()}) does not allow ${capability}`,
      );
    }

    return { project: membership.project, role: membership.role };
  }

  /** Convenience for the common "can they see it at all" check. */
  async findOneForUser(id: string, userId: string): Promise<Project> {
    const { project } = await this.authorize(id, userId, Capability.ProjectRead);
    return project;
  }

  async update(id: string, userId: string, dto: UpdateProjectDto): Promise<Project> {
    await this.authorize(id, userId, Capability.ProjectWrite);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  async archive(id: string, userId: string): Promise<void> {
    await this.authorize(id, userId, Capability.ProjectDelete);
    // Soft delete: projects own api keys, rooms, and usage history that
    // are still worth keeping around for audit/billing even after this.
    await this.prisma.project.update({
      where: { id },
      data: { status: ProjectStatus.ARCHIVED },
    });
  }
}
