// Migration 135 — Phase 5a: Player Settlements + Land Claims.
//
// Players can claim a circular plot of land (anchor + radius). Within
// the claim:
//   - Only the owner (or invited co-owners) can place buildings/nodes.
//   - Maintenance cost ticks down a wealth bond; unpaid claims expire.
//   - Other players entering the claim trigger a 'claim:trespass' event.
//
// Tables:
//   land_claims         — owner, world, anchor, radius, bond, maintenance
//   land_claim_invites  — co-owner allowlist
//   land_claim_events   — trespass / build / decay log

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS land_claims (
      id                 TEXT    PRIMARY KEY,
      owner_user_id      TEXT    NOT NULL,
      world_id           TEXT    NOT NULL,
      anchor_x           REAL    NOT NULL,
      anchor_z           REAL    NOT NULL,
      radius_m           REAL    NOT NULL CHECK (radius_m BETWEEN 5 AND 200),
      bond_sparks        INTEGER NOT NULL DEFAULT 0 CHECK (bond_sparks >= 0),
      maintenance_per_day INTEGER NOT NULL DEFAULT 5,
      claimed_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      last_maintained_at INTEGER NOT NULL DEFAULT (unixepoch()),
      status             TEXT    NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'expired', 'abandoned'))
    );
    CREATE INDEX IF NOT EXISTS idx_lc_world ON land_claims(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_lc_owner ON land_claims(owner_user_id, status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS land_claim_invites (
      claim_id      TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'co_owner'
                            CHECK (role IN ('co_owner', 'guest', 'tax_collector')),
      invited_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (claim_id, user_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS land_claim_events (
      id            TEXT    PRIMARY KEY,
      claim_id      TEXT    NOT NULL,
      kind          TEXT    NOT NULL CHECK (kind IN (
                              'trespass', 'build', 'decay',
                              'maintenance_paid', 'expired', 'invite')),
      actor_id      TEXT,
      detail_json   TEXT,
      occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_lce_claim ON land_claim_events(claim_id, occurred_at);
  `);
}

export function down(_db) { /* forward-only */ }
