// server/migrations/384_cross_domain_notebooks.js
//
// V1.2 Wave E grounding audit — "experiment notebooks as DTUs" (reproducible
// R&D with lineage) was found REAL-BUT-THIN: several per-domain "lab
// notebook" logs already exist and are siloed —
//   - server/domains/chem.js  (notebook-add/list/delete, ~line 1715) — an
//     in-memory `Map<userId, entry[]>` (module-scope globalThis, NOT SQL).
//   - server/domains/bio.js   (notebook-create/list/update/delete, ~1463) —
//     same in-memory-Map shape, per user.
//   - server/domains/science.js (notebook-add/update/list/delete, ~876) —
//     same shape again.
//   - server/domains/lab.js   (notebook-create/list/update/sign, ~731) — the
//     one durable exception (SQLite `lab_notebook_entries`), but scoped to
//     a single lab-bench org, not cross-domain.
// Each is a genuinely real per-domain log — nothing here replaces or
// duplicates any of their logic. None of them compose: a chem reaction, a
// bio sequence experiment, and a math/verify computation a researcher runs
// in the same investigation have no shared record, and none of them carry
// real reproducibility (re-invoking the SAME macro call and comparing
// outputs) or real DTU lineage (the existing royalty-cascade/provenance
// system in economy/royalty-cascade.js).
//
// This migration adds the missing durable, cross-domain composition layer:
//
//   notebooks       — one row per notebook (a named container a user
//                      creates to group related macro-call "cells" from ANY
//                      domain — chem + bio + math + dtu... — together).
//   notebook_cells  — one row per cell: a REAL macro-call record (domain,
//                      action, input, output, executed_at). `output_dtu_id`
//                      is populated ONLY when the underlying macro call's
//                      result genuinely carried a resolvable DTU id (see
//                      server/lib/notebook.js#extractDtuId) — never
//                      fabricated. `replay_of_cell_id` is set when a cell is
//                      a re-run of an earlier cell (server/domains/
//                      notebook.js's `replay-cell` macro), letting a
//                      notebook show a real reproducibility chain.
//
// Plain TEXT foreign keys with no SQL FOREIGN KEY constraint, matching this
// repo's established convention (see 378_projects.js's `goal_tree_id`,
// 377_workspace_rooms.js's `owner_id`) — referential validity is checked in
// the lib layer (server/lib/notebook.js), which reports a dangling
// reference honestly rather than fabricating one.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id            TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notebooks_owner ON notebooks(owner_user_id, updated_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notebook_cells (
      id                TEXT PRIMARY KEY,
      notebook_id       TEXT NOT NULL,
      position          INTEGER NOT NULL,
      domain            TEXT NOT NULL,
      action            TEXT NOT NULL,
      input_json        TEXT NOT NULL DEFAULT '{}',
      output_json       TEXT NOT NULL DEFAULT '{}',
      ok                INTEGER NOT NULL DEFAULT 1,
      error             TEXT,
      output_dtu_id     TEXT,
      replay_of_cell_id TEXT,
      executed_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notebook_cells_notebook ON notebook_cells(notebook_id, position)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notebook_cells_replay_of ON notebook_cells(replay_of_cell_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notebook_cells_dtu ON notebook_cells(output_dtu_id)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_notebook_cells_dtu`);
  db.exec(`DROP INDEX IF EXISTS idx_notebook_cells_replay_of`);
  db.exec(`DROP INDEX IF EXISTS idx_notebook_cells_notebook`);
  db.exec(`DROP TABLE IF EXISTS notebook_cells`);
  db.exec(`DROP INDEX IF EXISTS idx_notebooks_owner`);
  db.exec(`DROP TABLE IF EXISTS notebooks`);
}

export const description = "Cross-domain reproducible notebooks: notebooks + notebook_cells (real macro-call records with honest replay comparison + real DTU lineage)";
