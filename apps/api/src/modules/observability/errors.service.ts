import { Injectable } from '@nestjs/common';
import { Connection, ErrorEvent } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { QueryErrorsDto } from './dto/query-errors.dto';

type ErrorEventWithConnection = ErrorEvent & { connection: Connection | null };

/**
 * Every ID this service hands back is the developer-facing one (Phase 9
 * spec §9: one `conn_...` ID, used everywhere) — `ErrorEvent.connectionId`
 * is an internal database uuid FK, never the public ID, so every read
 * path here re-serializes it through the related `Connection.publicId`
 * rather than returning the raw column.
 */
@Injectable()
export class ErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForProject(projectId: string, query: QueryErrorsDto) {
    const rows = await this.prisma.errorEvent.findMany({
      where: {
        projectId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.connectionId ? { connection: { publicId: query.connectionId } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: query.limit,
      include: { connection: true },
    });

    return rows.map((row) => this.serialize(row));
  }

  async getDetail(projectId: string, publicId: string) {
    const errorEvent = await this.prisma.errorEvent.findUnique({
      where: { publicId },
      include: { connection: true },
    });

    if (!errorEvent || errorEvent.projectId !== projectId) {
      throw new NotFoundError('Error');
    }

    return { ...this.serialize(errorEvent), connection: errorEvent.connection };
  }

  private serialize(row: ErrorEventWithConnection) {
    const { connection, ...rest } = row;
    return { ...rest, connectionId: connection?.publicId ?? null };
  }
}
