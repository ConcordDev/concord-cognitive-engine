// server/migrations/076_concord_link.js
// The Concord Link — cross-world communication substrate.
//
// Three tables:
//   concord_link_messages  — every message ever sent across the Veil.
//                            Append-only audit log. Carries cost, encryption,
//                            corruption state, sender/receiver resonance, and
//                            source/dest worlds.
//   concord_link_anchors   — physical/metaphysical access points per world.
//                            Each world has 2-N anchors. Authored content.
//   concord_link_walkers   — emergent NPCs whose role is physical message
//                            delivery between worlds. Hireable.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS concord_link_messages (
        id                TEXT PRIMARY KEY,
        sender_id         TEXT NOT NULL,
        sender_kind       TEXT NOT NULL CHECK (sender_kind IN ('user', 'npc', 'emergent', 'system')),
        receiver_id       TEXT,
        receiver_kind     TEXT CHECK (receiver_kind IN ('user', 'npc', 'emergent', 'system', 'broadcast')),
        source_world      TEXT NOT NULL,
        dest_world        TEXT NOT NULL,
        message_type      TEXT NOT NULL
                            CHECK (message_type IN ('text', 'voice', 'data', 'dream', 'physical', 'broadcast', 'echo')),
        payload           TEXT NOT NULL,
        encryption_level  TEXT NOT NULL DEFAULT 'basic'
                            CHECK (encryption_level IN ('none', 'basic', 'high', 'shadow')),
        cost_paid         INTEGER NOT NULL DEFAULT 0,
        cost_currency     TEXT,
        emotional_weight  REAL NOT NULL DEFAULT 0.0,
        status            TEXT NOT NULL DEFAULT 'sent'
                            CHECK (status IN ('sent', 'delivered', 'corrupted', 'lost', 'intercepted')),
        corruption_note   TEXT,
        link_walker_id    TEXT,
        sent_at           INTEGER NOT NULL DEFAULT (unixepoch()),
        delivered_at      INTEGER,
        read_at           INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_msg_sender ON concord_link_messages(sender_id, sent_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_msg_receiver ON concord_link_messages(receiver_id, status, sent_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_msg_worlds ON concord_link_messages(source_world, dest_world, sent_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_msg_status ON concord_link_messages(status, sent_at DESC)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS concord_link_anchors (
        id           TEXT PRIMARY KEY,
        world_id     TEXT NOT NULL,
        name         TEXT NOT NULL,
        access_method TEXT NOT NULL,
        description  TEXT,
        location     TEXT,
        controlled_by_faction TEXT,
        stability    REAL NOT NULL DEFAULT 1.0,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_anchor_world ON concord_link_anchors(world_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS concord_link_walkers (
        id            TEXT PRIMARY KEY,
        npc_id        TEXT NOT NULL,
        home_world    TEXT NOT NULL,
        current_world TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'in_transit', 'on_contract', 'lost', 'dead')),
        contract_id   TEXT,
        reputation    INTEGER NOT NULL DEFAULT 50,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_walker_status ON concord_link_walkers(status, current_world)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  // Shadow Burn rate-limit tracking — per-sender daily count + cooldown.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS concord_link_shadow_burn (
        sender_id          TEXT PRIMARY KEY,
        messages_today     INTEGER NOT NULL DEFAULT 0,
        burn_severity      INTEGER NOT NULL DEFAULT 0,
        cooldown_until     INTEGER,
        last_message_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        last_reset_day     INTEGER NOT NULL DEFAULT (unixepoch() / 86400)
      )
    `);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
