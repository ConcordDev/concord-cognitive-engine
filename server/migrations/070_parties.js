// server/migrations/070_parties.js
// Player party / group system. Modeled on the guild_members pattern from 052
// but for ad-hoc small groups with invite/accept lifecycle.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parties (
        id          TEXT PRIMARY KEY,
        leader_id   TEXT NOT NULL,
        name        TEXT,
        max_size    INTEGER NOT NULL DEFAULT 8,
        privacy     TEXT NOT NULL DEFAULT 'invite_only'
                      CHECK (privacy IN ('invite_only', 'open')),
        loot_policy TEXT NOT NULL DEFAULT 'free_for_all'
                      CHECK (loot_policy IN ('free_for_all', 'round_robin', 'leader_loots')),
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        disbanded_at INTEGER,
        FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_parties_leader ON parties(leader_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_parties_active ON parties(disbanded_at)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS party_members (
        party_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('leader', 'member')),
        joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (party_id, user_id),
        FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(user_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS party_invites (
        id          TEXT PRIMARY KEY,
        party_id    TEXT NOT NULL,
        invited_id  TEXT NOT NULL,
        invited_by  TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at  INTEGER NOT NULL,
        responded_at INTEGER,
        FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_party_invites_invited ON party_invites(invited_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_party_invites_party ON party_invites(party_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
