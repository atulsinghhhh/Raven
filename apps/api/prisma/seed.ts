/**
 * Seeds a demo developer + project + API key + room so a fresh local
 * database has something to immediately explore (via /docs or curl)
 * instead of requiring a manual register→login→project→key round trip.
 *
 * Idempotent: re-running is safe — it upserts the demo user by email and
 * leaves existing projects/keys alone rather than duplicating them.
 *
 * Usage: pnpm --filter @raven/api prisma:seed  (or: pnpm db:seed from repo root)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import { createHmac, randomBytes } from 'crypto';
import { PrismaClient } from '../src/generated/prisma/client';

config({ path: ['../../.env', '.env'] });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_EMAIL = 'demo@raven.local';
const DEMO_PASSWORD = 'demo-password-123';

function pepperedSecret(secret: string): string {
  const pepper = process.env.API_KEY_HASH_SECRET;
  if (!pepper) {
    throw new Error('API_KEY_HASH_SECRET is not set — copy .env.example to .env first');
  }
  return createHmac('sha256', pepper).update(secret).digest('base64url');
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash, name: 'Demo Developer' },
  });

  let project = await prisma.project.findFirst({
    where: { ownerId: user.id, name: 'Demo Project' },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { ownerId: user.id, name: 'Demo Project', description: 'Seeded local demo project' },
    });
  }

  const existingKey = await prisma.apiKey.findFirst({
    where: { projectId: project.id, name: 'seed-key' },
  });

  let rawApiKey: string | null = null;
  if (!existingKey) {
    const publicId = `rvk_${randomBytes(9).toString('base64url')}`;
    const secret = randomBytes(32).toString('base64url');
    const secretHash = await bcrypt.hash(pepperedSecret(secret), 10);
    await prisma.apiKey.create({
      data: { projectId: project.id, publicId, secretHash, name: 'seed-key' },
    });
    rawApiKey = `${publicId}.${secret}`;
  }

  let room = await prisma.room.findFirst({
    where: { projectId: project.id, name: 'demo-room' },
  });
  if (!room) {
    room = await prisma.room.create({ data: { projectId: project.id, name: 'demo-room' } });
  }

  console.log('');
  console.log('Seed complete:');
  console.log(`  Developer login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log(`  Room: ${room.name} (${room.id})`);
  if (rawApiKey) {
    console.log(`  API key (shown once — this run only): ${rawApiKey}`);
  } else {
    console.log('  API key: already exists from a previous seed run (not re-shown)');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
