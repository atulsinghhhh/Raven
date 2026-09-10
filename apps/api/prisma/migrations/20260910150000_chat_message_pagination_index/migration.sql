-- Keyset pagination over chat history compares (createdAt, publicId): the
-- cursor carries the public `msg_...` id so it cannot leak an internal uuid
-- (see cursor.util.ts). The old index ended in `id`, so the tiebreaker half
-- of the predicate fell outside it and Postgres degraded to a filter scan --
-- measured at 11,084 buffers / 250ms for one 51-row page 150k rows into a
-- conversation, versus 10 buffers / 0.13ms once the index carries the column
-- actually being compared. The cost grew linearly with cursor depth, which is
-- the OFFSET pathology keyset pagination exists to avoid.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: Prisma runs each migration
-- inside a transaction and CONCURRENTLY cannot. On a chat_messages table
-- large enough for the build to matter, run the CONCURRENTLY pair by hand
-- first and let this migration no-op through IF NOT EXISTS / IF EXISTS.
CREATE INDEX IF NOT EXISTS "chat_messages_conversationId_createdAt_publicId_idx"
  ON "chat_messages" ("conversationId", "createdAt", "publicId");

-- Dropped only after the replacement exists, so the history read path is
-- never left unindexed.
DROP INDEX IF EXISTS "chat_messages_conversationId_createdAt_id_idx";
