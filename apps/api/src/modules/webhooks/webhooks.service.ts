import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, ValidationFailedError } from '../../shared/errors/app-error';
import { generateId } from '../../shared/utils/crypto.util';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

/** The endpoint as a developer sees it — signingSecret is never included. */
export type WebhookEndpointSummary = Omit<WebhookEndpoint, 'signingSecret'>;

export interface CreatedWebhookEndpoint extends WebhookEndpointSummary {
  /** Shown exactly once, at creation. Same one-time-reveal contract as an API key secret. */
  signingSecret: string;
  warning: string;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolved through ConfigService rather than read from `process.env`
   * directly — configuration.ts is where the default lives, and a bare
   * `process.env.NODE_ENV` is undefined in a normal local run, which
   * would silently put dev into the strictest branch.
   */
  private get environment(): string {
    return this.configService.get<string>('env') ?? 'development';
  }

  async create(projectId: string, dto: CreateWebhookDto): Promise<CreatedWebhookEndpoint> {
    assertDeliverableUrl(dto.url, this.environment);

    const signingSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        publicId: generateId('whe'),
        projectId,
        url: dto.url,
        description: dto.description,
        enabledEvents: dto.events ?? [],
        signingSecret,
      },
    });

    return {
      ...strip(endpoint),
      signingSecret,
      warning: 'Store this signing secret now — it is never shown again.',
    };
  }

  async list(projectId: string): Promise<WebhookEndpointSummary[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map(strip);
  }

  async update(projectId: string, publicId: string, dto: UpdateWebhookDto): Promise<WebhookEndpointSummary> {
    const endpoint = await this.findOne(projectId, publicId);
    if (dto.url) {
      assertDeliverableUrl(dto.url, this.environment);
    }
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        url: dto.url,
        description: dto.description,
        enabledEvents: dto.events,
        status: dto.status,
        // Re-enabling clears the failure streak, otherwise a fixed
        // endpoint would be one bad delivery away from disabling again.
        ...(dto.status === WebhookEndpointStatus.ACTIVE ? { consecutiveFailures: 0 } : {}),
      },
    });
    return strip(updated);
  }

  async remove(projectId: string, publicId: string): Promise<void> {
    const endpoint = await this.findOne(projectId, publicId);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
  }

  /** Delivery log for the dashboard (spec §32). Truncated errors only, never response bodies. */
  async listDeliveries(projectId: string, publicId: string, limit = 50): Promise<WebhookDelivery[]> {
    const endpoint = await this.findOne(projectId, publicId);
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      include: { event: { select: { publicId: true, type: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  private async findOne(projectId: string, publicId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { publicId } });
    // Scoped to projectId, not just publicId — same cross-project rule as
    // rooms and conversations.
    if (!endpoint || endpoint.projectId !== projectId) {
      throw new NotFoundError('Webhook endpoint');
    }
    return endpoint;
  }
}

function strip(endpoint: WebhookEndpoint): WebhookEndpointSummary {
  const { signingSecret: _secret, ...rest } = endpoint;
  return rest;
}

/**
 * Blocks the obvious SSRF shapes before we ever POST to a
 * developer-supplied URL: non-HTTP schemes, and loopback/link-local hosts
 * that would let a webhook reach services inside our own network.
 *
 * This is hostname-level only — it does not resolve DNS, so a hostname
 * pointing at a private IP still gets through. A production deployment
 * should also egress-filter the worker; noted in
 * docs/chat/webhooks.md#known-limitations rather than left implied.
 */
function assertDeliverableUrl(rawUrl: string, environment: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationFailedError('url must be a valid absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationFailedError('url must use http:// or https://');
  }
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new ValidationFailedError('Webhook URLs must use https:// in production');
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host === '[::1]';

  // Local dev genuinely needs to point a webhook at 127.0.0.1, so this is
  // only enforced outside development.
  if (blocked && environment !== 'development' && environment !== 'test') {
    throw new ValidationFailedError('url may not point at a loopback or private-network address');
  }
}
