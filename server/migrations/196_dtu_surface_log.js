// server/migrations/196_dtu_surface_log.js
//
// Phase 7 of the 10-dimension UX completeness sprint — cross-lens narrative.
//
// Without this table, a DTU minted in one lens never surfaces in the
// downstream lenses that cite or render it. Knowledge becomes
// disconnected: you write notes in `paper`, they cite a DTU from
// `chem`, but the chem lens never tells you "this DTU was cited 3
// times from paper this week." The substrate already tracks
// dtu_citations (one row per citation edge), but we never recorded
// the SURFACE — which lens RENDERED the DTU to the user. A surface
// row tells the upstream lens "your DTU is being used here."
//
// One table, append-only:
//
//   dtu_surface_log — one row per (dtu_id, surfaced_in_lens, user_id,
//                     created_at). When a downstream lens renders a
//                     DTU (in a feed, in a citation chip, in a quote
//                     block), it POSTs a row. Append-only; the
//                     upstream lens reads aggregations to render a
//                     "Used downstream" panel.
//
// Indexes:
//   - (dtu_id, created_at) — "where has this DTU surfaced?" per-DTU.
//   - (surfaced_in_lens, created_at) — "what surfaced here recently?"
//     for the downstream lens's "surfaced from elsewhere" tile.
//   - (user_id, created_at) — per-user audit; not required for the
//     core UX but useful for cross-lens analytics.
//
// Retention: not GC'd by this migration. A separate heartbeat
// (dtu-surface-log-gc) trims rows older than 365d.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_surface_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      dtu_id            TEXT NOT NULL,
      surfaced_in_lens  TEXT NOT NULL,
      user_id           TEXT,
      surface_kind      TEXT NOT NULL CHECK (surface_kind IN ('feed','citation_chip','quote_block','recent_card','downstream_panel','search_result','inline_link','export')),
      surface_meta_json TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_surface_log_dtu      ON dtu_surface_log(dtu_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_surface_log_lens     ON dtu_surface_log(surfaced_in_lens, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtu_surface_log_user     ON dtu_surface_log(user_id, created_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_dtu_surface_log_user`);
  db.exec(`DROP INDEX IF EXISTS idx_dtu_surface_log_lens`);
  db.exec(`DROP INDEX IF EXISTS idx_dtu_surface_log_dtu`);
  db.exec(`DROP TABLE IF EXISTS dtu_surface_log`);
}
