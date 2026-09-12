/**
 * One-off cleanup for the orphaned rooms/conversations left behind by the
 * P0 incident documented in LIVE_STREAM_P0_FIX_REPORT.md §1(a)/§4/§11:
 * `LiveStreamsService.create()` failing after creating a Room (and
 * sometimes a Conversation) but before the fix's compensating cleanup
 * existed. Both are named `stream_...`, `ACTIVE`, with no `LiveStream` row
 * ever pointing at them.
 *
 * Bootstraps the real Nest app context so this reuses `RoomsService.close()`
 * exactly as `LiveStreamsService.cleanupFailedCreate()` does — same
 * idempotent room-close + best-effort SFU/pub-sub teardown, not a
 * reimplementation. Conversations are archived the same way
 * `cleanupFailedCreate` does: a direct `status: ARCHIVED` update.
 *
 * Defaults to a dry run (identify + print, no writes). Pass --execute to
 * perform the cleanup. Requires DATABASE_URL (and everything else
 * apps/api's own config needs) in the environment, same as running the
 * app itself.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-orphaned-live-stream-rooms.ts
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-orphaned-live-stream-rooms.ts --execute
 */
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { RoomsService } from '../src/modules/rooms/rooms.service';
import { ConversationStatus } from '../src/generated/prisma/client';

/**
 * The report's confirmed count from the 2026-09-11 08:42–09:16 UTC
 * incident window. Not a hard filter — the identification query below
 * doesn't need a time window, since "ACTIVE room named stream_* with no
 * LiveStream row" is orphaned by definition regardless of when it was
 * created — but if the count found today doesn't match, that means either
 * some of the 15 were already cleared, or something outside this specific
 * incident also matches the shape. Either way, --execute refuses to run
 * unless you pass --force, so a surprise number gets a human look first.
 */
const EXPECTED_ORPHAN_COUNT = 15;

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const force = process.argv.includes('--force');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const roomsService = app.get(RoomsService);

    const orphanedRooms = await prisma.room.findMany({
      where: { name: { startsWith: 'stream_' }, status: 'ACTIVE', liveStream: null },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${orphanedRooms.length} orphaned room(s) (expected ${EXPECTED_ORPHAN_COUNT} per the P0 report).`);
    if (orphanedRooms.length !== EXPECTED_ORPHAN_COUNT && !force) {
      console.log(
        orphanedRooms.length === 0
          ? 'Nothing to do.'
          : 'Count does not match the report — re-run with --force once you have confirmed why before using --execute.',
      );
      if (execute && orphanedRooms.length !== 0) {
        console.log('Refusing to --execute without --force given the count mismatch.');
        return;
      }
    }

    const rows: Array<{ room: (typeof orphanedRooms)[number]; conversationId: string | null }> = [];
    for (const room of orphanedRooms) {
      const conversation = await prisma.conversation.findFirst({
        where: { roomId: room.id, name: room.name, status: 'ACTIVE' },
      });
      rows.push({ room, conversationId: conversation?.id ?? null });
    }

    console.log('');
    console.log('room.id'.padEnd(38), 'name'.padEnd(20), 'projectId'.padEnd(38), 'environment'.padEnd(12), 'createdAt'.padEnd(28), 'conversation.id');
    for (const { room, conversationId } of rows) {
      console.log(
        room.id.padEnd(38),
        room.name.padEnd(20),
        room.projectId.padEnd(38),
        room.environment.padEnd(12),
        room.createdAt.toISOString().padEnd(28),
        conversationId ?? '(none found)',
      );
    }

    if (!execute) {
      console.log('');
      console.log('Dry run only — no writes made. Re-run with --execute to close these rooms and archive their conversations.');
      return;
    }

    console.log('');
    console.log('Executing cleanup...');
    for (const { room, conversationId } of rows) {
      try {
        await roomsService.close(room.id, { projectId: room.projectId, environment: room.environment });
        console.log(`  closed room ${room.id} (${room.name})`);
      } catch (err) {
        console.error(`  FAILED to close room ${room.id}: ${(err as Error).message}`);
        continue;
      }

      if (conversationId) {
        try {
          await prisma.conversation.update({ where: { id: conversationId }, data: { status: ConversationStatus.ARCHIVED } });
          console.log(`  archived conversation ${conversationId}`);
        } catch (err) {
          console.error(`  FAILED to archive conversation ${conversationId}: ${(err as Error).message}`);
        }
      }
    }

    const remaining = await prisma.room.count({
      where: { name: { startsWith: 'stream_' }, status: 'ACTIVE', liveStream: null },
    });
    console.log('');
    console.log(`Verification: ${remaining} orphaned room(s) remain matching the same query.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
