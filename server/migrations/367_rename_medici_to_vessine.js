// server/migrations/367_rename_medici_to_vessine.js
//
// Content Integrity Sweep (name/IP-collision class — docs/CONTENT_INTEGRITY_SWEEP.md).
// The tunya "Medici" people (the real Florentine dynasty) were renamed to the
// coined "Vessine" across all authored content AND the runtime bloodline engine
// (lib/bloodline-powers.js — the `vessine` bloodline + its heal/bio/water
// elements), the NPC seeder (lib/concordia-npc-seeder.js KNOWN_BLOODLINES), and
// the frontend `tunya-vessine-ice` archetype.
//
// Migrations are append-only, so the "medici" identifier baked into already-run
// migrations (173_bloodline_ancestry's ancestry rows, 182_culture_marriage's
// culture assignment + seeded culture_relations) cannot be edited in place. This
// forward-repair migration renames the persisted identifier in existing DBs so
// stored rows match the new id. On a FRESH install this is a near-no-op: the
// seeder writes "vessine" from the start; only 182's seeded culture_relations
// rows carry "medici" before this runs.
//
// The subtle part is `culture_relations`: it has CHECK (culture_a < culture_b),
// so a naive `UPDATE ... SET culture_a='vessine'` would violate the constraint
// where the rename flips the sort order (e.g. (medici,sangree) → (vessine,sangree)
// with vessine > sangree). We delete + reinsert each affected row with the pair
// re-sorted.

export function up(db) {
  const hasTable = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

  const tx = db.transaction(() => {
    // Bloodline ancestry (mig 173) — the id lived in primary_bloodline.
    for (const t of ["user_ancestry", "npc_ancestry"]) {
      if (hasTable(t)) {
        db.prepare(`UPDATE ${t} SET primary_bloodline = 'vessine' WHERE primary_bloodline = 'medici'`).run();
      }
    }

    // Culture assignment (mig 182) — actor_culture.culture_id.
    if (hasTable("actor_culture")) {
      db.prepare("UPDATE actor_culture SET culture_id = 'vessine' WHERE culture_id = 'medici'").run();
    }

    // Culture relations (mig 182) — sorted-pair PK/CHECK. Delete + reinsert with
    // the pair re-sorted so the CHECK (culture_a < culture_b) still holds.
    if (hasTable("culture_relations")) {
      const rows = db.prepare(
        "SELECT culture_a, culture_b, friction FROM culture_relations WHERE culture_a = 'medici' OR culture_b = 'medici'",
      ).all();
      const del = db.prepare("DELETE FROM culture_relations WHERE culture_a = ? AND culture_b = ?");
      const ins = db.prepare(
        "INSERT INTO culture_relations (culture_a, culture_b, friction) VALUES (?, ?, ?) ON CONFLICT (culture_a, culture_b) DO NOTHING",
      );
      for (const r of rows) {
        del.run(r.culture_a, r.culture_b);
        let a = r.culture_a === "medici" ? "vessine" : r.culture_a;
        let b = r.culture_b === "medici" ? "vessine" : r.culture_b;
        if (a > b) [a, b] = [b, a]; // re-sort to satisfy CHECK (culture_a < culture_b)
        ins.run(a, b, r.friction);
      }
    }
  });
  tx();
}

// SQLite: identifier-rename is data-only; nothing to structurally roll back.
export function down(_db) { /* no-op — a value rename has no schema to revert */ }
