/**
 * Direct database reads the rig needs and the REST surface does not
 * expose, plus the one write it needs: clearing SFU registry rows left
 * behind by earlier runs.
 *
 * Kept to a deliberately short list. Everything the API can answer is
 * asked of the API — a capacity rig that reaches around the service it is
 * measuring stops measuring the service. What is here is either
 * housekeeping between runs or leak detection, which is by definition
 * asking whether the service's own view and the database agree.
 *
 * A stale registry row is not a hypothetical: a dead `sfu-lstest-01` row
 * left over from an earlier suite caused a real join failure while this
 * rig was being built, because the allocator handed a room to a node that
 * had not existed for hours.
 */
import pg from 'pg';

export class Db {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async query(sql, params = []) {
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  /** Removes every registry row except the node this run owns, so allocation is deterministic. */
  async clearForeignSfuRows(keepNodeId) {
    const rows = await this.query('DELETE FROM rtc_servers WHERE name <> $1 RETURNING name, status', [keepNodeId]);
    return rows;
  }

  listSfuRows() {
    return this.query(
      'SELECT name, region, "internalUrl", status, capacity, "activeRooms", "lastHeartbeatAt" FROM rtc_servers ORDER BY name',
    );
  }

  /**
   * Participant rows for a room, grouped by identity.
   *
   * `participants` carries a UNIQUE (roomId, identity), so this cannot
   * show a duplicate and a count above 1 would mean the constraint had
   * been dropped. It is checked anyway, cheaply, because that constraint
   * is precisely what the AddParticipant session-replacement fix relies
   * on, and a rig that assumes an invariant holds is not testing it.
   *
   * The durable-session leak this is paired with lives elsewhere — in
   * Redis (`roomParticipantCount`) and in the SFU's own participant gauge
   * — because a row here is created at mint time and is expected to
   * outlive the connection.
   */
  participantsForRoom(roomId) {
    return this.query(
      'SELECT identity, COUNT(*)::int AS sessions FROM participants WHERE "roomId" = $1 GROUP BY identity ORDER BY identity',
      [roomId],
    );
  }

  async roomIdForStream(streamPublicId) {
    const rows = await this.query('SELECT "roomId" FROM live_streams WHERE "publicId" = $1', [streamPublicId]);
    return rows[0]?.roomId ?? null;
  }

  /** Postgres-side connection accounting, for Phase 9's pool ceiling check. */
  async connectionStats() {
    const [{ total, active, idle }] = await this.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE state = 'active')::int AS active,
              COUNT(*) FILTER (WHERE state = 'idle')::int AS idle
         FROM pg_stat_activity
        WHERE datname = current_database()`,
    );
    const [{ max_connections }] = await this.query(
      "SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections'",
    );
    return { total, active, idle, maxConnections: max_connections };
  }

  async close() {
    await this.pool.end();
  }
}
