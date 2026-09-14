import { Injectable } from '@nestjs/common';
import { ErrorCategory, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { NotFoundError } from '../../../shared/errors/app-error';
import { QueryGroupedErrorsDto } from './dto/query-grouped-errors.dto';

export interface GroupedErrorRow {
  category: ErrorCategory;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  affectedProjects: number;
  affectedDevelopers: number;
}

export interface GroupedErrorPage {
  items: GroupedErrorRow[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Platform-wide error grouping (spec §15) — the same `ErrorEvent` table
 * `ErrorsService` (observability) reads per-project, grouped by
 * `category` + `message` across every project instead.
 *
 * Prisma's `groupBy` gives count/first-seen/last-seen cheaply, but not
 * "how many distinct projects/developers hit this" — that needs a join
 * through `Project.owner`, which `groupBy` can't express. Rather than
 * pulling every matching `ErrorEvent` row up front (unbounded, and most
 * of it thrown away), this runs the cheap `groupBy` first, pages *that*,
 * and only fans out one small per-group query for the page actually
 * requested. Bounded by `MAX_LIMIT` groups per call, so the worst case is
 * 200 small queries, not one query over the whole table.
 */
@Injectable()
export class ErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  async listGrouped(query: QueryGroupedErrorsDto): Promise<GroupedErrorPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.ErrorEventWhereInput = query.category ? { category: query.category } : {};

    const groups = await this.prisma.errorEvent.groupBy({
      by: ['category', 'message'],
      where,
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    // Sorted in application code rather than via Prisma's groupBy
    // `orderBy` on an aggregated field, which is version-fragile across
    // Prisma releases — the group count here is small enough (bounded by
    // distinct category+message pairs, not raw event volume) that an
    // in-memory sort is negligible.
    const sorted = groups.sort((a, b) => b._count._all - a._count._all);
    const total = sorted.length;
    const page = sorted.slice(offset, offset + limit);

    const items = await Promise.all(
      page.map(async (group): Promise<GroupedErrorRow> => {
        const rows = await this.prisma.errorEvent.findMany({
          where: { category: group.category, message: group.message },
          select: { projectId: true, project: { select: { ownerId: true } } },
        });

        const affectedProjects = new Set(rows.map((r) => r.projectId)).size;
        const affectedDevelopers = new Set(rows.map((r) => r.project.ownerId)).size;

        return {
          category: group.category,
          message: group.message,
          count: group._count._all,
          firstSeen: (group._min.timestamp ?? new Date(0)).toISOString(),
          lastSeen: (group._max.timestamp ?? new Date(0)).toISOString(),
          affectedProjects,
          affectedDevelopers,
        };
      }),
    );

    return { items, total };
  }

  async getDetail(publicId: string) {
    const row = await this.prisma.errorEvent.findUnique({
      where: { publicId },
      include: {
        connection: true,
        project: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            owner: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundError('Error');
    }

    const { connection, project, ...rest } = row;
    return {
      ...rest,
      connectionId: connection?.publicId ?? null,
      connection,
      project,
    };
  }
}
