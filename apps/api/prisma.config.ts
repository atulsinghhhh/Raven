import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Mirrors app.module.ts's env lookup: root .env first, package-local as fallback.
config({ path: ['../../.env', '.env'] });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
