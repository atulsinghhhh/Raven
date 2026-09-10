import { Injectable } from '@nestjs/common';
import { Project, ProjectStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../shared/errors/app-error';
import { normalizeOriginList } from '../../shared/origins/origin-policy';
import { ProjectOriginService } from '../../shared/origins/project-origin.service';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { Capability, ProjectRole, can } from './project-permissions';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateAllowedOriginsDto } from './dto/update-allowed-origins.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/** A project the caller is allowed to touch, plus the role that allowed it. */
export interface AuthorizedProject {
  project: Project;
  role: ProjectRole;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly origins: ProjectOriginService,
  ) {}

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

  /**
   * Replaces a project's browser-origin allow-list.
   *
   * The whole list, not a delta, so removing an origin is expressible.
   * Entries are normalized before storage (see normalizeOriginList) which
   * is what lets request-time matching be an exact string comparison, and
   * anything that is not an origin is refused here — at the one boundary
   * where a human is present to read the error — rather than stored and
   * quietly never matched.
   */
  async updateAllowedOrigins(
    id: string,
    userId: string,
    dto: UpdateAllowedOriginsDto,
  ): Promise<Project> {
    await this.authorize(id, userId, Capability.ProjectWrite);

    const { origins, invalid } = normalizeOriginList(dto.allowedOrigins);
    if (invalid.length > 0) {
      throw new ValidationFailedError(
        `Not valid browser origins: ${invalid.join(', ')}. An origin is a scheme, host and optional port, ` +
          'for example https://app.example.com or http://localhost:3000. Paths and wildcards are not allowed.',
      );
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        allowedOrigins: origins,
        ...(dto.allowLocalhostOrigins === undefined
          ? {}
          : { allowLocalhostOrigins: dto.allowLocalhostOrigins }),
      },
    });

    // The policy is cached on the hot path, so a dashboard edit that only
    // took effect on the next TTL expiry would read as the setting not
    // working. Awaited so the broadcast to the other API instances is on
    // its way before this responds: a developer who saves a change and
    // immediately reconnects a client should not race their own edit.
    await this.origins.invalidate(id);

    return project;
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
