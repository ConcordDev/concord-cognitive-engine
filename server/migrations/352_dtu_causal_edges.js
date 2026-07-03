// server/migrations/352_dtu_causal_edges.js
//
// DW1 — DTU causal-edge layer (Pearl-style causal DAG typing).
//
// This is a SEPARATE, additive layer on top of the DTU substrate. It is
// DELIBERATELY DISCONNECTED from the citation/royalty graph
// (migration 008's `royalty_lineage` table + server/economy/royalty-cascade.js):
// that graph is constitutional (money-shaped — creator credit, cascade payouts)
// and this one is not. A causal edge never implies a citation and a citation
// never implies a causal edge; the two graphs may reference the same DTU ids
// but are otherwise independent and must stay that way.
//
//   id          PK
//   child_id    the DOWNSTREAM/effect DTU (see server/lib/causal-edges.js
//               header comment for the exact directionality convention used
//               by traceCausalPath)
//   parent_id   the UPSTREAM/cause DTU
//   edge_type   causes | enables | prevents | corrects | analogizes
//   confidence  [0,1] — how sure the author/system is of the causal claim
//   created_at  unix seconds
//
// Forward-only; table-guarded. Migrations are append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_causal_edges (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      edge_type TEXT NOT NULL CHECK(edge_type IN ('causes','enables','prevents','corrects','analogizes')),
      confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_causal_edges_child ON dtu_causal_edges(child_id);
    CREATE INDEX IF NOT EXISTS idx_causal_edges_parent ON dtu_causal_edges(parent_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS dtu_causal_edges;`);
}
