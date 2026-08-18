import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKey, ApiKeyStatus, Project } from '../../generated/prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UnauthorizedError } from '../../shared/errors/app-error';
import {
  generateApiKeyPublicId,
  generateApiKeySecret,
  pepper as applyPepper,
} from '../../shared/utils/crypto.util';
import { DEFAULT_ENVIRONMENT, Environment } from '../../shared/environment/environment.constants';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const SECRET_SALT_ROUNDS = 10;

export interface CreatedApiKey {
  id: string;
  name: string | null;
  publicId: string;
  environment: Environment;
  /** The only time the raw secret is ever available. Not recoverable afterwards. */
  key: string;
  createdAt: Date;
}

/**
 * What a verified key authorises: a project, and exactly one environment
 * within it.
 */
export interface VerifiedApiKey {
  project: Project;
  environment: Environment;
  /** The key's own public id — distinct from `project.id`, so two keys on
   *  the same project can be rate-limited (and revoked) independently. */
  publicId: string;
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
    const environment = dto.environment ?? DEFAULT_ENVIRONMENT;
    const publicId = generateApiKeyPublicId(environment);
    const secret = generateApiKeySecret();
    const secretHash = await bcrypt.hash(this.pepperedSecret(secret), SECRET_SALT_ROUNDS);

    const apiKey = await this.prisma.apiKey.create({
      data: { projectId, publicId, secretHash, name: dto.name, environment },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      publicId: apiKey.publicId,
      environment: apiKey.environment,
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
        environment: true,
        status: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
    });
  }

  /** Returns the revoked key so the caller can describe it in an audit entry. */
  async revoke(projectId: string, keyId: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!apiKey || apiKey.projectId !== projectId) {
      throw new NotFoundError('API key');
    }

    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });
  }

  /**
   * Authenticates a raw `publicId.secret` key from the Authorization
   * header and returns its project. ApiKeyAuthGuard uses this to scope
   * Room and RTC Token requests to one project.
   */
  async verify(rawKey: string): Promise<VerifiedApiKey> {
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

    // Best-effort — must never block the actual request if this fails.
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    // The environment travels with the key, never with the request. A
    // caller cannot ask to act in production; it either holds a production
    // key or it does not.
    return { project: apiKey.project, environment: apiKey.environment, publicId: apiKey.publicId };
  }
}
