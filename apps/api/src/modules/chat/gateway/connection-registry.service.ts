import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionState } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { randomBytes } from 'crypto';
import { RedisKeys } from '../chat.constants';
import { Environment } from '../../../shared/environment/environment.constants';

/**
 * Tracks live chat sockets in two places, for two different reasons.
 *
 * **Redis** holds the routing/liveness view: which gateway owns a
 * connection, and which connections a user currently has open. It's TTL'd
 * and refreshed by the heartbeat, so a gateway that dies without cleaning
 * up doesn't leave phantom connections behind (spec §35).
 *
 * **Postgres** holds one durable row per session, mirroring the RTC
 * `Connection` model so the dashboard's connection views work the same
 * way on both planes. This is a session record, not a presence log;
 * one row per socket, not one per state change.
 */
@Injectable()
export class ConnectionRegistryService {
  private readonly logger = new Logger(ConnectionRegistryService.name);
  /** Identifies this process in a fleet: the thing you need when one instance misbehaves. */
  readonly gatewayId = `gw_${process.pid.toString(36)}_${randomBytes(3).toString('hex')}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    // Same TTL as presence: both are refreshed by the same heartbeat, and
    // having them expire at different times would only create windows
    // where one says "online" and the other says "gone".
    return this.configService.get<number>('chat.presenceTtlSeconds')!;
  }

  /**
   * Registers a new socket. The Postgres write is awaited (the dashboard
   * should see the connection immediately); the Redis write is not
   * allowed to fail the connection.
   */
  async register(input: {
    connectionId: string;
    projectId: string;
    environment: Environment;
    userId: string;
    sdkVersion?: string;
    platform?: string;
  }): Promise<string | undefined> {
    await this.touch(input.connectionId, input.projectId, input.userId);

    try {
      const row = await this.prisma.chatConnection.create({
        data: {
          publicId: input.connectionId,
          projectId: input.projectId,
          environment: input.environment,
          userId: input.userId,
          gatewayId: this.gatewayId,
          state: ConnectionState.CONNECTED,
          sdkVersion: input.sdkVersion,
          platform: input.platform,
          connectedAt: new Date(),
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      // An unrecorded connection is a gap in the dashboard, not a reason
      // to refuse a user's chat session.
      this.logger.error(`could not record chat connection: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Heartbeat refresh. Re-arms both TTLs well before they lapse. */
  async touch(connectionId: string, projectId: string, userId: string): Promise<void> {
    try {
      await this.redisService.client
        .multi()
        .hset(RedisKeys.connection(connectionId), {
          gatewayId: this.gatewayId,
          projectId,
          userId,
        })
        .expire(RedisKeys.connection(connectionId), this.ttlSeconds)
        .sadd(RedisKeys.userConnections(projectId, userId), connectionId)
        .expire(RedisKeys.userConnections(projectId, userId), this.ttlSeconds * 4)
        .exec();
    } catch (err) {
      this.logger.warn(`connection registry refresh failed: ${(err as Error).message}`);
    }
  }

  async unregister(input: {
    connectionId: string;
    connectionRowId?: string;
    projectId: string;
    userId: string;
    connectedAt: Date;
    messagesSent: number;
    reason: string;
  }): Promise<void> {
    try {
      await this.redisService.client
        .multi()
        .del(RedisKeys.connection(input.connectionId))
        .srem(RedisKeys.userConnections(input.projectId, input.userId), input.connectionId)
        .exec();
    } catch (err) {
      this.logger.warn(`connection registry cleanup failed: ${(err as Error).message}`);
    }

    if (!input.connectionRowId) {
      return;
    }
    try {
      const now = new Date();
      await this.prisma.chatConnection.update({
        where: { id: input.connectionRowId },
        data: {
          state: ConnectionState.DISCONNECTED,
          disconnectReason: input.reason,
          disconnectedAt: now,
          durationMs: now.getTime() - input.connectedAt.getTime(),
          messagesSent: input.messagesSent,
        },
      });
    } catch (err) {
      this.logger.warn(`could not close chat connection row: ${(err as Error).message}`);
    }
  }

  /** How many live sockets a user has across the whole fleet, not just this instance. */
  async countUserConnections(projectId: string, userId: string): Promise<number> {
    try {
      return await this.redisService.client.scard(RedisKeys.userConnections(projectId, userId));
    } catch {
      return 0;
    }
  }
}
