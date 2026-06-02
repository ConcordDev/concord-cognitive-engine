// server/migrations/323_item_enchantments.js
//
// G6 — enchantment. The fuel system amplifies NEW creations, but there was no way
// to enchant EXISTING gear, and (the audit's gap) no hard tier-lock: a soul-gem's
// tier should CAP the enchant power (a petty gem can't make a black-tier effect).
// This persists an enchant applied to an item — affinity (from the essence) +
// potency (capped by the gem tier) + an effect id.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_enchantments (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      world_id    TEXT,
      item_id     TEXT NOT NULL,        -- the gear the enchant rides on
      affinity    TEXT NOT NULL,        -- magic|tech|bio|physical|chaos (from the essence)
      potency     REAL NOT NULL,        -- 0..gem-tier-cap
      effect_id   TEXT NOT NULL,        -- spell_power|life_steal|sharpness|volatile_edge|...
      gem_tier    TEXT NOT NULL,        -- petty|grand|black (which gem set the ceiling)
      essence_id  TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_item_enchantments_user_item ON item_enchantments(user_id, item_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS item_enchantments;`);
}
