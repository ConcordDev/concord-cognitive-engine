// server/migrations/182_culture_marriage.js
//
// Concordia Phase 13 — cultural/faith friction + marriage.
//
// Three tables:
//
//   actor_culture — culture + faith per (actor_kind, actor_id).
//     culture_id and faith_id are free-form slugs matching authored
//     entries in content/world/concordia-hub/cultures.json.
//
//   culture_relations — sorted-pair PK (culture_a < culture_b) with
//     CHECK; signed friction -1..+1. Mirrors faction_relations from
//     mig 117 so the recordOpinionEvent path can apply it as an
//     opinion delta modifier without re-implementing pair handling.
//
//   marriages — sorted-pair PK on (actor1, actor2) with composite
//     identity (actor1_kind | actor1_id) < (actor2_kind | actor2_id).
//     status active|divorced|widowed. Used by Phase 13 dialogue and
//     by Phase 12 dynasty cascade (heir = married partner if no
//     biological heirs).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS actor_culture (
      actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('player','npc')),
      actor_id    TEXT NOT NULL,
      culture_id  TEXT NOT NULL,
      faith_id    TEXT,
      established_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (actor_kind, actor_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS culture_relations (
      culture_a TEXT NOT NULL,
      culture_b TEXT NOT NULL,
      friction  REAL NOT NULL DEFAULT 0 CHECK (friction BETWEEN -1.0 AND 1.0),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (culture_a < culture_b),
      PRIMARY KEY (culture_a, culture_b)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS marriages (
      id          TEXT PRIMARY KEY,
      partner_a_kind TEXT NOT NULL CHECK (partner_a_kind IN ('player','npc')),
      partner_a_id   TEXT NOT NULL,
      partner_b_kind TEXT NOT NULL CHECK (partner_b_kind IN ('player','npc')),
      partner_b_id   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','divorced','widowed')),
      married_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at    INTEGER,
      end_reason  TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marriage_a ON marriages(partner_a_kind, partner_a_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marriage_b ON marriages(partner_b_kind, partner_b_id, status)`);

  // Seed a small set of known friction pairs so Phase 13 lights up
  // immediately on a fresh build. Authoring lives in content/world/
  // concordia-hub/cultures.json (the seeder upserts more on boot).
  const insertRel = db.prepare(`
    INSERT INTO culture_relations (culture_a, culture_b, friction) VALUES (?, ?, ?)
    ON CONFLICT (culture_a, culture_b) DO NOTHING
  `);
  // Friction values: negative = hostile, positive = friendly.
  // CHECK enforces culture_a < culture_b — sort lexicographically.
  const seed = (a, b, f) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    insertRel.run(x, y, f);
  };
  seed("dinye", "fluxom", -0.6);   // Bloc vs Fluxom hostile
  seed("aekon", "fluxom", -0.6);
  seed("akeia", "fluxom", -0.4);
  seed("medici", "sangree", -0.2); // Medici / Sangree awkward coexistence
  seed("kree", "medici", -0.2);
  seed("akeia", "sahm",     0.2);  // Akeia / Sahm trade-friendly
  seed("dinye", "akeia",    0.1);
  seed("aekon", "asbir",    0.4);  // Bloc inner solidarity
  seed("asbir", "dinye",    0.4);
  seed("aekon", "dinye",    0.4);
}

export function down(_db) {
  // Forward-only.
}
