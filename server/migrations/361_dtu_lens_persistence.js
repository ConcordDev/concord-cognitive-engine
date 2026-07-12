// server/migrations/361_dtu_lens_persistence.js
//
// Durable persistence for two per-user features of the `dtus` knowledge-base
// browser lens (server/domains/dtus.js): saved views / smart collections
// (a named facet-filter) and the 4-layer DTU editor's per-user overlay
// (human/core/machine/artifact edits layered on top of a DTU without
// mutating the substrate original). Both previously lived ENTIRELY in
// globalThis._concordSTATE.dtusLens — plain in-memory Maps keyed by userId
// — so every saved view and every layer edit was lost on server restart.
// Tracked as an open gap in docs/lens-specs/dtus-capability-map.md and
// docs/WAVE4_INVENTORY.md's `| dtus |` row.
//
// This does NOT touch the main `dtus` table (the DTU substrate itself,
// already durable) or any of dtus.js's other macros (lineage/quality/
// citation-network/tier-recommendation/duplicate-detection/citationGraph/
// facets/facetedSearch/lineageTree/bulkOp/compareDtus/mergeDtus) — those
// are all pure-compute over caller-supplied corpora and never touched the
// in-memory Maps this migration replaces.
//
// Two tables, following the fidelity-over-normalization pattern already
// established at migration 356 (saved_items) and migration 360
// (bracket_tournaments):
//
//   dtu_saved_views — one row per saved view. `filter_json` is a TEXT blob
//   because the facet-filter shape (query/layers/tiers/scopes/tags/
//   minQuality/maxQuality) is caller-defined and arbitrary — normalizing it
//   into columns would need to track every future facet the UI adds. `name`
//   and `user_id` are real columns because list/lookup filter on them.
//
//   dtu_layer_overlays — one row per (user_id, dtu_id): the natural key
//   IS the composite primary key (a user has at most one overlay per DTU,
//   mirroring the in-memory `Map<userId, Map<dtuId, layers>>` shape
//   one-for-one). The 4 layers are stored as plain TEXT columns (not one
//   JSON blob) because each layer is independently read/written by the
//   editor UI and the `core`/`machine` layers are themselves free-form
//   text that MAY contain JSON (validated at the macro layer, not the
//   schema layer) — a real column per layer keeps that read/write surgical
//   and avoids an extra JSON.parse/stringify round-trip on every partial
//   edit.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_saved_views (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      filter_json TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dtu_saved_views_user
      ON dtu_saved_views(user_id);

    CREATE TABLE IF NOT EXISTS dtu_layer_overlays (
      user_id     TEXT NOT NULL,
      dtu_id      TEXT NOT NULL,
      human       TEXT NOT NULL DEFAULT '',
      core        TEXT NOT NULL DEFAULT '',
      machine     TEXT NOT NULL DEFAULT '',
      artifact    TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (user_id, dtu_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dtu_layer_overlays_user
      ON dtu_layer_overlays(user_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_dtu_layer_overlays_user;
    DROP TABLE IF EXISTS dtu_layer_overlays;
    DROP INDEX IF EXISTS idx_dtu_saved_views_user;
    DROP TABLE IF EXISTS dtu_saved_views;
  `);
}
