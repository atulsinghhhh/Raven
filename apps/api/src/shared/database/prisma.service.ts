import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// Module-level, not a class field: `onPoolError` below is constructed as
// an argument to `super()`, and a class field referencing `this` isn't
// initialized until after `super()` returns — a closure created there
// can't safely rely on `this.logger` existing yet.
const logger = new Logger('PrismaService');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = logger;

  constructor() {
    super({
      adapter: new PrismaPg(
        {
          connectionString: process.env.DATABASE_URL,
          // Every pod's pool competes for the same Postgres
          // max_connections — see configuration.ts's `database.poolMax`
          // comment for the horizontal-scaling reasoning. Read directly
          // from env, same as DATABASE_URL above (Prisma 7 dropped the
          // datasource url from schema.prisma; this file and
          // prisma.config.ts are the two places left that read it).
          max: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
          idleTimeoutMillis: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
          connectionTimeoutMillis: parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? '5000', 10),
        },
        {
          // Pool-level failures (e.g. every connection refused) don't
          // otherwise surface anywhere — without this they'd be silent
          // until the next query happened to hit them.
          onPoolError: (err) => logger.error(`pg pool error: ${err.message}`),
        },
      ),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Used by the health module — throws if the database is unreachable. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
