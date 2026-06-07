// server/migrations/328_npc_deception_lens.js
//
// Wave 7 / B7-extension (Context 14) — durable per-NPC deception sensitivities. The
// empathy-lens (server/lib/empathy-lens.js) reads these as the `sensitivities` seed
// when building an NPC's reconstruction lens, and writes them when a con is CAUGHT
// (driftLensFromDeception). This is what makes the counter-deception arms race a
// population property: getting conned raises this NPC's sensitivity to that tell-kind,
// so the same con gets read next time — deception breeds its own counter, no script.
// Keyed (npc_id, tell_kind). Forward-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_deception_lens (
      npc_id       TEXT NOT NULL,
      tell_kind    TEXT NOT NULL,        -- deception | seduction | blackmail | ...
      sensitivity  REAL NOT NULL DEFAULT 0,  -- 0..1, earned from caught cons
      world_id     TEXT,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, tell_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_deception_lens_npc ON npc_deception_lens(npc_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS npc_deception_lens;`);
}
