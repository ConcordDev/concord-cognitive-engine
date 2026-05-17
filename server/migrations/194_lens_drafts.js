// server/migrations/194_lens_drafts.js
//
// Phase 1 of the 10-dimension UX completeness sprint — auto-save drafts.
//
// Pre-this-migration only 5.4% of lenses (13/239) wrote any user state to
// localStorage, and none persisted server-side. Compose a long pharmacy
// note, lose the tab, lose the work. The "Mint" button was the only
// write-path. This is what real productivity apps (Notion, Linear, Figma)
// have done since their first version: persist every keystroke, debounced.
//
// One table, append-only:
//
//   lens_drafts — one row per (user_id, lens_id, draft_key). The
//                 `draft_key` is lens-defined (often the field name like
//                 "newMedNote", "rxIntakeText", "spellRecipeDraft"). The
//                 server stores the payload as opaque JSON; the lens
//                 author owns the shape. `schema_version` lets a lens
//                 bump and migrate stored drafts in-app if their shape
//                 evolves.
//
// Indexes:
//   - UNIQUE (user_id, lens_id, draft_key) — caller protocol: load + save
//     by the triple. UPSERT idempotency comes from this constraint.
//   - (user_id, lens_id) — list-mine for the "Reopen recent" surface
//     mounted in each lens via LoadFromSubstrate.
//   - (updated_at) — heartbeat-driven GC sweep at >30d.
//
// Caller protocol (Phase 1 hooks):
//   - `useLensDraft(lensId, key)` debounces 1500ms and POSTs to
//     drafts.save. localStorage holds the offline mirror.
//   - On mount, drafts.load hydrates state; if the localStorage mirror
//     is newer (offline edits queued), it overrides and re-pushes.
//   - drafts.list_mine drives the "Reopen recent" tile.
//   - drafts.delete is called when the user explicitly clears OR when
//     a mint succeeds (the draft has graduated to a real DTU).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lens_drafts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      lens_id         TEXT NOT NULL,
      draft_key       TEXT NOT NULL,
      payload_json    TEXT NOT NULL,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (user_id, lens_id, draft_key)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_drafts_user_lens ON lens_drafts(user_id, lens_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_drafts_updated_at ON lens_drafts(updated_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_lens_drafts_updated_at`);
  db.exec(`DROP INDEX IF EXISTS idx_lens_drafts_user_lens`);
  db.exec(`DROP TABLE IF EXISTS lens_drafts`);
}
