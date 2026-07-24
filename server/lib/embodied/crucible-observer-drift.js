// server/lib/embodied/crucible-observer-drift.js
//
// lattice-crucible bespoke mechanic — "player-conditional drift".
//
// Grounded in authored lore (see migration 391 for the full citation):
// Orla (witness_orla) privately suspects — and the lore's hidden_truth
// confirms — that the lattice produces a class of drift alerts ONLY
// when a player is physically present in the Crucible. Nowhere else in
// Concord does drift-born content depend on player presence: the global
// lattice-quest-cycle / drift-monitor heartbeats fire on a fixed cadence
// regardless of who's watching. This module makes that lore claim real
// and testable, and reuses the federation's own drift taxonomy
// (server/emergent/drift-monitor.js#DRIFT_TYPES) rather than inventing
// a parallel one — the Crucible's drift is drawn from the same
// substrate everyone else's is, per the world's own framing ("every
// region here is a procgen response to a real drift alert").
//
// Honest-by-construction: the mechanic never fabricates a drift event.
// It only ever writes a row while a real, live world_visits row proves
// the caller is standing in lattice-crucible right now. Every other
// path returns an explicit ok:false reason — no partial success.

import crypto from "node:crypto";
import { ALL_DRIFT_TYPES } from "../../emergent/drift-monitor.js";

export const CRUCIBLE_WORLD_ID = "lattice-crucible";

// Hour-bucketed determinism: repeated calls from the same observer
// within the same hour reproduce the same drift type (prevents log
// spam from resolving to a different "random" classification every
// call, and keeps the mechanic reproducible for tests) while still
// varying hour to hour and observer to observer.
export function pickDriftType(seedStr) {
  const digest = crypto.createHash("sha1").update(String(seedStr)).digest();
  const idx = digest[0] % ALL_DRIFT_TYPES.length;
  return ALL_DRIFT_TYPES[idx];
}

/**
 * Is this specific user currently standing in lattice-crucible? Real
 * presence check against world_visits — an open (undeparted) row, not
 * a cached flag.
 */
export function isObserverPresent(db, worldId, userId) {
  if (!db || !worldId || !userId) return false;
  try {
    const row = db.prepare(`
      SELECT id FROM world_visits
      WHERE world_id = ? AND user_id = ? AND departed_at IS NULL
      ORDER BY arrived_at DESC LIMIT 1
    `).get(worldId, userId);
    return !!row;
  } catch {
    // world_visits missing on a minimal build — degrade honestly, don't
    // fabricate presence.
    return false;
  }
}

const SEVERITY_BY_DRIFT_TYPE = Object.freeze({
  goodhart: "warning",
  memetic_drift: "info",
  capability_creep: "warning",
  self_reference: "alert",
  echo_chamber: "info",
  metric_divergence: "warning",
});

// Orla's speech_patterns: "Uses 'the lattice' as a third party. Refuses
// to anthropomorphize even under duress." Her corpus notes are written
// in that clinical register, never narrative flourish.
function composeCorpusNote(driftType, observerUserId) {
  return `The lattice produced a ${driftType} alert while an observer ` +
    `(${observerUserId}) held an open presence in the Crucible. No ` +
    `equivalent alert precedes this one in the unobserved baseline.`;
}

/**
 * The mechanic's real effect: record one player-conditional drift
 * event, but ONLY when (a) the world is genuinely lattice-crucible and
 * (b) the caller genuinely has an open world_visits row there right
 * now. Every other call is an honest failure, never a fabricated
 * success.
 *
 * Returns { ok, driftType, logId, corpusSize } on success or
 * { ok:false, reason } otherwise.
 */
export function recordObserverDrift(db, { worldId, userId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== CRUCIBLE_WORLD_ID) return { ok: false, reason: "not_lattice_crucible" };
  if (!userId) return { ok: false, reason: "no_actor" };
  if (!isObserverPresent(db, worldId, userId)) {
    return { ok: false, reason: "no_observer_present" };
  }

  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const driftType = pickDriftType(`${userId}|${worldId}|${hourBucket}`);
  const severity = SEVERITY_BY_DRIFT_TYPE[driftType] || "info";
  const id = `cod_${crypto.randomUUID()}`;
  const corpusNote = composeCorpusNote(driftType, userId);

  db.prepare(`
    INSERT INTO crucible_observer_drift_log
      (id, world_id, observer_user_id, drift_type, severity, corpus_note, disclosed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, worldId, userId, driftType, severity, corpusNote);

  const { c: corpusSize } = db.prepare(`
    SELECT COUNT(*) AS c FROM crucible_observer_drift_log WHERE world_id = ?
  `).get(worldId);

  return { ok: true, driftType, severity, logId: id, corpusSize };
}

/**
 * Orla's private corpus — the compiled record she has not shown the
 * other Witnesses. Scoped identically to the write path: any world
 * other than lattice-crucible gets an honest failure, never an empty
 * "success" that could be misread as "confirmed nothing happens here."
 */
export function getOrlaCorpus(db, { worldId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== CRUCIBLE_WORLD_ID) return { ok: false, reason: "not_lattice_crucible" };

  const rows = db.prepare(`
    SELECT drift_type, severity, disclosed, created_at
    FROM crucible_observer_drift_log
    WHERE world_id = ?
    ORDER BY created_at ASC
  `).all(worldId);

  const byDriftType = {};
  for (const r of rows) {
    byDriftType[r.drift_type] = (byDriftType[r.drift_type] || 0) + 1;
  }

  return {
    ok: true,
    totalEvents: rows.length,
    byDriftType,
    disclosed: rows.length > 0 && rows.every((r) => r.disclosed === 1),
    firstRecordedAt: rows[0]?.created_at ?? null,
    lastRecordedAt: rows[rows.length - 1]?.created_at ?? null,
  };
}

/**
 * "She has been waiting... she will release it if the Charter Question
 * resolves in favor of intervention" — a deliberate, explicit act, not
 * an automatic one. This flips every currently-recorded event's
 * disclosed flag; it is never called implicitly by recordObserverDrift.
 */
export function discloseCorpus(db, { worldId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== CRUCIBLE_WORLD_ID) return { ok: false, reason: "not_lattice_crucible" };

  const result = db.prepare(`
    UPDATE crucible_observer_drift_log SET disclosed = 1 WHERE world_id = ?
  `).run(worldId);

  return { ok: true, disclosedCount: result.changes };
}
