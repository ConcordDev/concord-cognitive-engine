// server/migrations/359_run_mode_modifiers.js
//
// Wave 4 gap-closure — horde/roguelite draft-pick + meta-unlock modifiers
// actually apply to gameplay (see server/lib/run-modifiers.js).
//
// Three additive columns on roguelite_runs so a run can carry state that
// must be applied at start and reversed/consumed symmetrically:
//
//   hp_bonus_applied       INTEGER — the EXACT startingHpBonus (from owned
//     meta-unlocks, e.g. veteran_vigor) that was added to the player's
//     player_resource_bars at startRun(). Stored (not recomputed) so endRun()
//     removes precisely what was added even if the player buys another
//     meta-unlock mid-run — recomputing at end time could over-subtract.
//   revives_remaining      INTEGER — seeded from the 'second_chance'
//     meta-unlock's effect.value at startRun(); decremented by
//     maybeReviveRoguelitePlayer() each time it prevents a death.
//   draft_picks_available  INTEGER — banked in-run draft picks. Every
//     advanceRun() grants (1 + extraDraftPicks) more; every successful
//     run_draft pick (via pickDraftBoon) spends one. Banking across draft
//     rounds (rather than a strict "1 extra pick this round only" rule) is
//     the simpler, honest interpretation of a PERMANENT meta-unlock
//     (extra_pick) — see run-modifiers.js's doc comment for the reasoning.
//
// All three default to 0 so a pre-existing row (a run created before this
// migration) reads as "no bonus applied / no revives / no banked picks" —
// harmless for an already-ended run, and a still-active run simply won't
// have had these mechanics available until its next natural transition.
//
// Append-only per CLAUDE.md invariant; previous migrations are untouched.

function columnExists(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col); }
  catch { return false; }
}

export function up(db) {
  // Skip cleanly if the table doesn't exist on a minimal build.
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roguelite_runs'").get()) return;

  if (!columnExists(db, "roguelite_runs", "hp_bonus_applied")) {
    db.exec(`ALTER TABLE roguelite_runs ADD COLUMN hp_bonus_applied INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists(db, "roguelite_runs", "revives_remaining")) {
    db.exec(`ALTER TABLE roguelite_runs ADD COLUMN revives_remaining INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists(db, "roguelite_runs", "draft_picks_available")) {
    db.exec(`ALTER TABLE roguelite_runs ADD COLUMN draft_picks_available INTEGER NOT NULL DEFAULT 0`);
  }
}

export function down(_db) {
  // SQLite < 3.35 can't DROP COLUMN. Forward-only; the columns are additive
  // and default to 0, so leaving them is harmless.
}
