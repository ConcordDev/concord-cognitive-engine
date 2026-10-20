// Player–player courtship needs a proposal the partner can accept or decline,
// a per-day interaction cap, and a notice that does not carry a raw account id.
// The romance engine also creates these tables on first use so a DB that has
// not yet migrated still refuses one-sided player marriages.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_courtship_proposals (
      id TEXT PRIMARY KEY,
      proposer_user_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_courtship_proposals_partner
      ON player_courtship_proposals (partner_id, status);
    CREATE TABLE IF NOT EXISTS player_courtship_daily (
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      day_key INTEGER NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_user_id, partner_kind, partner_id, day_key)
    );
    CREATE TABLE IF NOT EXISTS player_courtship_notices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_courtship_notices_user
      ON player_courtship_notices (user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS player_courtship_notices;
    DROP TABLE IF EXISTS player_courtship_daily;
    DROP TABLE IF EXISTS player_courtship_proposals;
  `);
}

export const description = "Player courtship consent proposals, daily cap, and notices";
