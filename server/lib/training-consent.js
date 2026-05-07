// server/lib/training-consent.js
//
// Helpers for managing the train_consented flag across every table
// that's a candidate training-data source for the Lattice (6th) brain.
//
// Two regimes (see migrations/108_lattice_train_consent.js header):
//   - User-authored: default 0, explicit opt-in required (dtus,
//     culture_resonance).
//   - Platform-generated: default 1, can be flipped to 0 per-row for
//     selective redaction (world_events_log, evo_assets, etc.).
//
// The corpus extractor in lib/training/corpus-extractor.js (future)
// will SELECT only rows with train_consented = 1.

const USER_AUTHORED_TABLES = ["dtus", "culture_resonance"];

const PLATFORM_TABLES = [
  "world_events_log",
  "evo_assets",
  "evo_asset_interactions",
  "damage_events",
  "minigame_events",
  "opinion_events",
  "creature_corpses",
  "world_facts",
];

const ALL_CONSENT_TABLES = [...USER_AUTHORED_TABLES, ...PLATFORM_TABLES];

/**
 * Flip a user-authored DTU's train_consented flag.
 *
 * @param {object} db
 * @param {string} dtuId
 * @param {string} userId      — must own the DTU
 * @param {boolean} consented  — true to opt in, false to opt out
 * @returns {{ ok: boolean, dtuId?: string, consented?: boolean, error?: string }}
 */
export function setDtuTrainConsent(db, dtuId, userId, consented) {
  if (!db || !dtuId || !userId) return { ok: false, error: "missing_args" };
  const row = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(dtuId);
  if (!row) return { ok: false, error: "dtu_not_found" };
  if (row.creator_id !== userId) return { ok: false, error: "not_owner" };
  db.prepare(`UPDATE dtus SET train_consented = ? WHERE id = ?`).run(consented ? 1 : 0, dtuId);
  return { ok: true, dtuId, consented: !!consented };
}

/**
 * Bulk-flip every DTU owned by a user. Useful for an account-wide
 * "opt all my work into Lattice training" toggle.
 *
 * @param {object} db
 * @param {string} userId
 * @param {boolean} consented
 * @returns {{ ok: boolean, updated: number }}
 */
export function setAllDtusTrainConsent(db, userId, consented) {
  if (!db || !userId) return { ok: false, updated: 0, error: "missing_args" };
  const r = db.prepare(`UPDATE dtus SET train_consented = ? WHERE creator_id = ?`)
    .run(consented ? 1 : 0, userId);
  return { ok: true, updated: r.changes };
}

/**
 * Set platform-content consent for a specific row. Used for selective
 * redaction (e.g., GDPR deletion request that needs to remove a
 * particular world_event_log row from training corpus).
 *
 * @param {object} db
 * @param {string} table   — must be in PLATFORM_TABLES
 * @param {string} idCol   — primary-key column name (e.g., "id")
 * @param {string} idValue
 * @param {boolean} consented
 */
export function setPlatformRowConsent(db, table, idCol, idValue, consented) {
  if (!PLATFORM_TABLES.includes(table)) {
    return { ok: false, error: "table_not_consent_eligible" };
  }
  // idCol is whitelisted to prevent SQL injection — only allow simple
  // identifier characters.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idCol)) {
    return { ok: false, error: "invalid_id_col" };
  }
  const r = db.prepare(`UPDATE ${table} SET train_consented = ? WHERE ${idCol} = ?`)
    .run(consented ? 1 : 0, idValue);
  return { ok: true, updated: r.changes };
}

/**
 * Aggregate corpus stats per table — counts of consented vs total rows.
 * Used for the corpus dashboard / Lattice-readiness check.
 *
 * @param {object} db
 * @returns {{ tables: Array<{ name: string, total: number, consented: number, ratio: number }> }}
 */
export function getCorpusStats(db) {
  const tables = [];
  for (const name of ALL_CONSENT_TABLES) {
    try {
      const total = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get().c;
      const consented = db.prepare(`SELECT COUNT(*) as c FROM ${name} WHERE train_consented = 1`).get().c;
      tables.push({
        name,
        total,
        consented,
        ratio: total === 0 ? 0 : Number((consented / total).toFixed(4)),
        regime: USER_AUTHORED_TABLES.includes(name) ? "user_opt_in" : "platform_default_in",
      });
    } catch (_e) {
      // Table may not exist on older databases; skip silently.
    }
  }
  return { tables };
}

/**
 * For testing / verification: list every table that should carry the
 * train_consented column, partitioned by regime.
 */
export function listConsentTables() {
  return {
    userAuthored: [...USER_AUTHORED_TABLES],
    platform: [...PLATFORM_TABLES],
  };
}
