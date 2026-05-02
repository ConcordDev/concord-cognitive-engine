// server/migrations/078_faction_policy_state.js
// Persistent policy state per faction, written when council debates (CRI summits)
// resolve into referendum outcomes. Read by NPC dialogue + behavior shifts so
// the world visibly reacts to council decisions.
//
// Factions themselves live as JSON content + an in-memory _authoredFactions map
// (see server/lib/content-seeder.js). We only persist what changes at runtime.
//
// Schema:
//   faction_id         — id from content/world/**/factions.json
//   policy_state_json  — array of resolved referendum outcomes [{ topic, outcome, ts, summit_id }]
//   updated_at         — unix timestamp of last write

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS faction_policy_state (
        faction_id        TEXT PRIMARY KEY,
        policy_state_json TEXT NOT NULL DEFAULT '[]',
        updated_at        INTEGER NOT NULL
      )
    `);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_faction_policy_updated ON faction_policy_state(updated_at DESC)`);
  } catch (_e) { /* best-effort */ }
}
