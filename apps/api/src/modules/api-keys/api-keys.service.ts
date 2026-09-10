import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKey, ApiKeyStatus, Project } from '../../generated/prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UnauthorizedError } from '../../shared/errors/app-error';
import { generateApiKeyPublicId, generateApiKeySecret, pepper as applyPepper } from '../../shared/utils/crypto.util';
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
  /** The key's own public id: distinct from `project.id`, so two keys on
   *  the same project can be rate-limited (and revoked) independently. */
  publicId: string;
}

/**
 * One remembered bcrypt result: this exact secret was already compared
 * against this exact hash, and matched.
 */
interface VerifiedSecret {
  /** The `secretHash` the comparison was made against. */
  secretHash: string;
  /** When this entry stops being trusted, in epoch milliseconds. */
  expiresAt: number;
}

@Injectable()
export class ApiKeysService {
  /**
   * Recently-verified secrets, keyed by public id.
   *
   * ## Why this cache has to exist
   *
   * `bcryptjs` is a pure-JavaScript bcrypt. Its "async" API wraps a
   * synchronous computation, so a comparison does not yield to the event
   * loop — it *blocks* Node's single thread for the whole thing, about 75ms
   * at cost factor 10. Every API-key-authenticated request pays it, which
   * puts a hard ceiling of roughly thirteen requests per second per process
   * on the entire REST surface, whatever the database is doing. That was
   * measured and root-caused in docs/production/capacity-report.md §1.3 and
   * then never fixed.
   *
   * It matters most exactly where Live Streaming is most exposed: a hundred
   * viewers arriving at once send a hundred mints carrying the *same*
   * project key, and the old path recomputed the same comparison a hundred
   * times, single-file, before any of them reached Postgres.
   *
   * ## What is cached, and what is deliberately not
   *
   * The comparison result, and nothing else. `verify` still reads the key's
   * row from Postgres on **every single request**, and still checks
   * `status` on every single request. So revoking a key takes effect
   * immediately — the row goes to REVOKED and the next request is refused
   * no matter how recently its secret was verified. Caching the
   * authorization *decision* would be a security hole; caching the
   * expensive arithmetic behind it is not.
   *
   * The entry is bound to the `secretHash` it was verified against, so
   * rotating a key invalidates it implicitly: a new hash never matches a
   * cached entry, and the comparison runs again for real.
   *
   * ## What the TTL actually costs
   *
   * The window in which a *rotated* secret would still be accepted, if the
   * old row were somehow left ACTIVE with its old hash. A minute is
   * unremarkable next to the token TTLs this same API hands out.
   *
   * Process-local, not Redis. The value here is skipping a CPU-bound
   * computation, and a Redis round trip to avoid 75ms of local CPU would
   * reintroduce most of the latency it was meant to remove. Each process
   * warming its own is fine.
   */
  private readonly verifiedSecrets = new Map<string, VerifiedSecret>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * A positive number from config, or the fallback.
   *
   * Guarded rather than trusted because a non-numeric value here fails
   * *silently and invisibly*: `NaN` milliseconds makes `expiresAt` NaN,
   * every `expiresAt <= now` comparison false, and the entry immortal — a
   * cache that never expires, with nothing to see in a log. Same shape of
   * bug as an unguarded admission ceiling; see AdmissionControlService.
   */
  private numericConfig(key: string, fallback: number): number {
    const raw = Number(this.configService.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private get cacheTtlMs(): number {
    return this.numericConfig('apiKeyCache.ttlSeconds', 60) * 1000;
  }

  private get cacheMaxEntries(): number {
    return this.numericConfig('apiKeyCache.maxEntries', 5000);
  }

  /**
   * The cache key. Includes a hash of the presented secret, so a *wrong*
   * secret for a real public id can never hit an entry created by the
   * right one.
   *
   * SHA-256 rather than bcrypt precisely because it is fast: this is a
   * lookup key for an already-authenticated value, not a password hash.
   * The secret is high-entropy and randomly generated (see
   * `generateApiKeySecret`), so there is nothing here for a slow hash to
   * protect against — and the peppered secret never leaves the process.
   */
  private cacheKeyFor(publicId: string, pepperedSecret: string): string {
    return `${publicId}:${createHash('sha256').update(pepperedSecret).digest('hex')}`;
  }

  /**
   * Whether this secret was already verified against this same hash, and
   * recently enough to still trust.
   */
  private wasRecentlyVerified(cacheKey: string, secretHash: string): boolean {
    const hit = this.verifiedSecrets.get(cacheKey);
    if (!hit) {
      return false;
    }
    // A rotated key has a new hash, so its old entry can never match.
    if (hit.secretHash !== secretHash || hit.expiresAt <= Date.now()) {
      this.verifiedSecrets.delete(cacheKey);
      return false;
    }
    return true;
  }

  private rememberVerified(cacheKey: string, secretHash: string): void {
    // Bounded, so a deployment sprayed with distinct keys cannot grow this
    // without limit. Oldest-first eviction: Map preserves insertion order,
    // and re-inserting on a hit is not worth the churn for a cache whose
    // entries all expire within a minute anyway.
    if (this.verifiedSecrets.size >= this.cacheMaxEntries) {
      const oldest = this.verifiedSecrets.keys().next();
      if (!oldest.done) {
        this.verifiedSecrets.delete(oldest.value);
      }
    }
    this.verifiedSecrets.set(cacheKey, { secretHash, expiresAt: Date.now() + this.cacheTtlMs });
  }

  /**
   * Drops every cached verification for a key.
   *
   * Not needed for correctness — `verify` re-reads `status` from Postgres
   * on every request, so a revoked or rotated key stops working without
   * this. It is here so the cache does not hold entries for secrets that
   * can no longer be used, and so a test can prove the eviction happens.
   */
  forgetVerifiedSecrets(publicId: string): void {
    for (const key of this.verifiedSecrets.keys()) {
      if (key.startsWith(`${publicId}:`)) {
        this.verifiedSecrets.delete(key);
      }
    }
  }

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

    const revoked = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });

    // Housekeeping, not the security boundary. `verify` re-reads `status`
    // on every request, so this key is already dead on the next call in
    // every process — including the ones whose caches this cannot reach.
    this.forgetVerifiedSecrets(apiKey.publicId);

    return revoked;
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

    // Note what has already happened above, and happens on every request
    // regardless of the cache: the row was read, and its status was
    // checked. Only the ~75ms of blocking bcrypt arithmetic below is
    // skippable. See `verifiedSecrets`.
    const peppered = this.pepperedSecret(secret);
    const cacheKey = this.cacheKeyFor(apiKey.publicId, peppered);

    if (!this.wasRecentlyVerified(cacheKey, apiKey.secretHash)) {
      const matches = await bcrypt.compare(peppered, apiKey.secretHash);
      if (!matches) {
        throw new UnauthorizedError('Invalid API key');
      }
      this.rememberVerified(cacheKey, apiKey.secretHash);
    }

    // Best-effort: must never block the actual request if this fails.
    this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    // The environment travels with the key, never with the request. A
    // caller cannot ask to act in production; it either holds a production
    // key or it does not.
    return { project: apiKey.project, environment: apiKey.environment, publicId: apiKey.publicId };
  }
}
