import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { UserTokenType } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';

export interface IssuedUserToken {
  /** The raw token. Exists in memory and in one email. Never persisted, never logged. */
  token: string;
  expiresAt: Date;
}

/**
 * SHA-256, hex. Not bcrypt — see the schema comment on `UserToken`: the
 * input is 32 bytes of CSPRNG output, so there is no weak secret for a
 * slow KDF to defend, and a plain digest is what lets a lookup be a single
 * indexed read instead of a table scan of every candidate row.
 */
export function hashUserToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues and redeems the single-use tokens that email verification and
 * password reset are built on.
 *
 * Three properties the callers depend on:
 *
 * - **Only a hash is stored.** A dump of `user_tokens` cannot be replayed
 *   into a password reset.
 * - **Single-use, enforced by the database.** `consume()` marks the row in
 *   a conditional `updateMany`, so two requests carrying the same token
 *   race for one row and exactly one wins. Checking-then-updating would
 *   let both through.
 * - **Issuing invalidates the previous one.** Asking for a second reset
 *   link kills the first: a link sitting unused in an inbox is a live
 *   credential, and "the newest link works" is also what users expect.
 */
@Injectable()
export class UserTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, type: UserTokenType, ttlMinutes: number): Promise<IssuedUserToken> {
    // 32 bytes = 256 bits of entropy, base64url so it survives a URL
    // unescaped (no +, /, or = to be mangled by a mail client rewriting
    // links).
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.prisma.userToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.userToken.create({
      data: { userId, type, tokenHash: hashUserToken(token), expiresAt },
    });

    // Opportunistic cleanup instead of a background sweeper: this table
    // only grows when someone asks for a link, so the moment of asking is
    // exactly when it is worth tidying, and it costs one indexed delete
    // rather than another interval worker in every API instance.
    await this.purgeStale(userId);

    return { token, expiresAt };
  }

  /**
   * Returns the owning user id, or null for anything that is not a live,
   * unused token of this exact type. Null covers every failure the same
   * way on purpose — a caller that could tell "expired" from "already
   * used" from "never existed" would hand that distinction to whoever is
   * guessing tokens.
   */
  async consume(token: string, type: UserTokenType): Promise<string | null> {
    const row = await this.prisma.userToken.findUnique({
      where: { tokenHash: hashUserToken(token) },
      select: { id: true, userId: true, type: true, expiresAt: true, consumedAt: true },
    });

    if (!row || row.type !== type || row.consumedAt !== null || row.expiresAt <= new Date()) {
      return null;
    }

    const { count } = await this.prisma.userToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // Lost the race to a concurrent redemption of the same link. One of
    // the two must lose, and it is this one.
    return count === 1 ? row.userId : null;
  }

  /** Invalidates every outstanding token of a type — used after a reset succeeds. */
  async revokeAll(userId: string, type: UserTokenType): Promise<void> {
    await this.prisma.userToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  private async purgeStale(userId: string): Promise<void> {
    // Consumed and expired rows are kept briefly so a user who clicks a
    // link twice still gets "this link was already used" rather than a
    // blank 400 — a week is long enough for that and short enough that
    // the table stays small.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.prisma.userToken.deleteMany({
      where: { userId, expiresAt: { lt: cutoff } },
    });
  }
}
