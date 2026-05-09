// Migration 147 — Concordia Procedural Mount System Phase B4: polish.
// (Renumbered from 145 on rebase: 145 reserved for PR #310's
// macro_call_billing, 146 for PR #311's repair_feedback. Next free is 147.)
//
// Skill columns on player_companions for the mount-evolution path,
// the mount_care_events ledger for the care heartbeat, and the
// `mount_state` JSON column on combat_actor_state so the combat path
// can apply the `mounted_modifier` overlay multiplicatively on top of
// each of the five existing combat profiles.
//
// CLAUDE.md invariant added by this phase:
//   Mounted combat applies `MOUNTED_MODIFIER` overlay multiplicatively
//   on top of the 5 base profiles. Overlay is read from
//   `combat_actor_state.mount_state.mounted_modifier_active`. Mount
//   evolution shares the skill-evolution envelope via
//   author_kind='mount'. Care decay computed lazily from `last_seen_at`;
//   heartbeat MAY trigger but MUST NOT be sole source. 24h decay cap
//   regardless of downtime.

export function up(db) {
  // --- player_companions skill columns (idempotent) ---
  const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
  if (!cols.includes("gait_skill"))     db.exec(`ALTER TABLE player_companions ADD COLUMN gait_skill REAL NOT NULL DEFAULT 0.0`);
  if (!cols.includes("combat_skill"))   db.exec(`ALTER TABLE player_companions ADD COLUMN combat_skill REAL NOT NULL DEFAULT 0.0`);
  if (!cols.includes("flight_skill"))   db.exec(`ALTER TABLE player_companions ADD COLUMN flight_skill REAL NOT NULL DEFAULT 0.0`);
  if (!cols.includes("evolution_tier")) db.exec(`ALTER TABLE player_companions ADD COLUMN evolution_tier INTEGER NOT NULL DEFAULT 0`);
  if (!cols.includes("last_ridden_at")) db.exec(`ALTER TABLE player_companions ADD COLUMN last_ridden_at INTEGER`);

  // --- mount_care_events: append-only audit ledger for the care cycle ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS mount_care_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      companion_id    TEXT    NOT NULL,
      event_type      TEXT    NOT NULL CHECK (event_type IN ('feed', 'groom', 'rest', 'neglect_decay')),
      delta_loyalty   REAL    NOT NULL DEFAULT 0,
      delta_stamina   REAL    NOT NULL DEFAULT 0,
      delta_hunger    REAL    NOT NULL DEFAULT 0,
      meta_json       TEXT    NOT NULL DEFAULT '{}',
      ts              INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mount_care_events_companion_ts
      ON mount_care_events(companion_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_mount_care_events_type_ts
      ON mount_care_events(event_type, ts DESC);
  `);

  // --- combat_actor_state.mount_state: JSON for the overlay ---
  // Probe before adding — combat_actor_state schema lives in mig 140.
  let casCols = [];
  try {
    casCols = db.prepare("PRAGMA table_info(combat_actor_state)").all().map(c => c.name);
  } catch { /* combat_actor_state may not exist on minimal test DBs */ }
  if (casCols.length > 0 && !casCols.includes("mount_state")) {
    db.exec(`ALTER TABLE combat_actor_state ADD COLUMN mount_state TEXT`);
  }
}

export function down(_db) { /* forward-only */ }
