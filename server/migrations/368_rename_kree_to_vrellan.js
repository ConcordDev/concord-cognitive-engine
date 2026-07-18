// server/migrations/368_rename_kree_to_vrellan.js
//
// Content Integrity Sweep (name/IP-collision class — docs/CONTENT_INTEGRITY_SWEEP.md).
// The tunya "Kree" nation (Marvel's trademarked alien-race name) was renamed to
// the coined "Vrellan" across all authored content AND the runtime bloodline
// engine (lib/bloodline-powers.js — the `vrellan` bloodline + its fire/energy
// elements), the NPC seeder (lib/concordia-npc-seeder.js KNOWN_BLOODLINES +
// FACTION_TO_BLOODLINE), and the frontend `tunya-savanna` style mapping +
// BloodlineBadge short-code.
//
// Migrations are append-only, so the "kree" identifier baked into already-run
// migrations (173_bloodline_ancestry's ancestry rows, 182_culture_marriage's
// culture assignment + seeded culture_relations) cannot be edited in place. This
// forward-repair migration renames the persisted identifier in existing DBs so
// stored rows match the new id. On a FRESH install this is a near-no-op: the
// seeder writes "vrellan" from the start; only 182's seeded culture_relations
// rows carry "kree" before this runs (and only after 367 has already renamed
// "medici" -> "vessine" in the same table).
//
// The subtle part is `culture_relations`: it has CHECK (culture_a < culture_b),
// so a naive `UPDATE ... SET culture_a='vrellan'` would violate the constraint
// where the rename flips the sort order. Migration 182 seeds `("kree", "medici")`;
// after 367 renames medici -> vessine that row becomes `("kree", "vessine")`
// (no resort needed there: "kree" < "vessine"). This migration then renames
// kree -> vrellan: `("vrellan", "vessine")` would violate the CHECK ("vrellan" >
// "vessine"), so we delete + reinsert with the pair re-sorted to
// `("vessine", "vrellan")`.

export function up(db) {
  const hasTable = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

  const tx = db.transaction(() => {
    // Bloodline ancestry (mig 173) — the id lived in primary_bloodline.
    for (const t of ["user_ancestry", "npc_ancestry"]) {
      if (hasTable(t)) {
        db.prepare(`UPDATE ${t} SET primary_bloodline = 'vrellan' WHERE primary_bloodline = 'kree'`).run();
      }
    }

    // Culture assignment (mig 182) — actor_culture.culture_id.
    if (hasTable("actor_culture")) {
      db.prepare("UPDATE actor_culture SET culture_id = 'vrellan' WHERE culture_id = 'kree'").run();
    }

    // Culture relations (mig 182) — sorted-pair PK/CHECK. Delete + reinsert with
    // the pair re-sorted so the CHECK (culture_a < culture_b) still holds.
    if (hasTable("culture_relations")) {
      const rows = db.prepare(
        "SELECT culture_a, culture_b, friction FROM culture_relations WHERE culture_a = 'kree' OR culture_b = 'kree'",
      ).all();
      const del = db.prepare("DELETE FROM culture_relations WHERE culture_a = ? AND culture_b = ?");
      const ins = db.prepare(
        "INSERT INTO culture_relations (culture_a, culture_b, friction) VALUES (?, ?, ?) ON CONFLICT (culture_a, culture_b) DO NOTHING",
      );
      for (const r of rows) {
        del.run(r.culture_a, r.culture_b);
        let a = r.culture_a === "kree" ? "vrellan" : r.culture_a;
        let b = r.culture_b === "kree" ? "vrellan" : r.culture_b;
        if (a > b) [a, b] = [b, a]; // re-sort to satisfy CHECK (culture_a < culture_b)
        ins.run(a, b, r.friction);
      }
    }
  });
  tx();
}

// SQLite: identifier-rename is data-only; nothing to structurally roll back.
export function down(_db) { /* no-op — a value rename has no schema to revert */ }
