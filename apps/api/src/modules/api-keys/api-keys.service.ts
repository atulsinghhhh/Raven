import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKey, ApiKeyStatus, Project } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UnauthorizedError } from '../../shared/errors/app-error';
import {
  generateApiKeyPublicId,
  generateApiKeySecret,
  pepper as applyPepper,
} from '../../shared/utils/crypto.util';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const SECRET_SALT_ROUNDS = 10;

export interface CreatedApiKey {
  id: string;
  name: string | null;
  publicId: string;
  /** The only time the raw secret is ever available. Not recoverable afterwards. */
  key: string;
  createdAt: Date;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private pepperedSecret(secret: string): string {
    return applyPepper(secret, this.configService.get<string>('apiKey.pepper')!);
  }

  async create(projectId: string, dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    const publicId = generateApiKeyPublicId();
    const secret = generateApiKeySecret();
    const secretHash = await bcrypt.hash(this.pepperedSecret(secret), SECRET_SALT_ROUNDS);

    const apiKey = await this.prisma.apiKey.create({
      data: { projectId, publicId, secretHash, name: dto.name },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      publicId: apiKey.publicId,
      key: `${publicId}.${secret}`,
      createdAt: apiKey.createdAt,
    };
  }

  findAllForProject(projectId: string): Promise<Omit<ApiKey, 'secretHash'>[]> {
    return this.prisma.apiKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        publicId: true,
        name: true,
        status: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
    });
  }

  async revoke(projectId: string, keyId: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!apiKey || apiKey.projectId !== projectId) {
      throw new NotFoundError('API key');
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });
  }

  /**
   * Authenticates a raw `publicId.secret` key (as sent in an Authorization
   * header) and returns the project it belongs to. Used by ApiKeyAuthGuard
   * to scope Room and RTC Token requests to exactly one project.
   */
  async verify(rawKey: string): Promise<Project> {
    const [publicId, secret] = rawKey.split('.', 2);
    if (!publicId || !secret) {
      throw new UnauthorizedError('Malformed API key');
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { publicId },
      include: { project: true },
    });

    if (!apiKey || apiKey.status !== ApiKeyStatus.ACTIVE) {
      throw new UnauthorizedError('Invalid or revoked API key');
    }

    const matches = await bcrypt.compare(this.pepperedSecret(secret), apiKey.secretHash);
    if (!matches) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Best-effort — a failure here must never block the actual request.
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return apiKey.project;
  }
}
