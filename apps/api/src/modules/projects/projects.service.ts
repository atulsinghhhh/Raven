import { Injectable } from '@nestjs/common';
import { Project, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateProjectDto): Promise<Project> {
    return this.prisma.project.create({
      data: { name: dto.name, description: dto.description, ownerId },
    });
  }

  findAllForOwner(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerId, status: ProjectStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneForOwner(id: string, ownerId: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    // Same NotFoundError whether the project doesn't exist or belongs to
    // someone else — a 403 there would confirm the project ID is real,
    // leaking information about another user's account.
    if (!project || project.ownerId !== ownerId) {
      throw new NotFoundError('Project');
    }

    return project;
  }

  async update(id: string, ownerId: string, dto: UpdateProjectDto): Promise<Project> {
    await this.findOneForOwner(id, ownerId);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  async archive(id: string, ownerId: string): Promise<void> {
    await this.findOneForOwner(id, ownerId);
    // Soft delete: projects own api keys, rooms, and usage history that
    // stay valuable for audit/billing purposes even after "deletion".
    await this.prisma.project.update({
      where: { id },
      data: { status: ProjectStatus.ARCHIVED },
    });
  }
}
