// server/migrations/082_emergent_skills.js
//
// Storage for the emergent skills registry. Skills are not picked from a
// static list — they are authored at runtime by NPCs / emergents / users /
// enemies during gameplay. Each row holds the full Skill JSON; the runtime
// loads it into an in-memory cache (server/lib/emergent-skills.js).
//
// parent_id chains derivative skills (skill X learned from skill Y) so the
// skill tree is provenance-traceable.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS emergent_skills (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        verb            TEXT,
        json            TEXT NOT NULL,
        origin          TEXT,
        parent_id       TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_emergent_skills_parent ON emergent_skills(parent_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_emergent_skills_origin ON emergent_skills(origin)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }
}
