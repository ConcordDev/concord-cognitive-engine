// server/emergent/affect-trace-cycle.js
//
// Wave 7 / A6 (creature path) — the somatic-memory flush. Creatures have no DTUs of
// their own, so their felt life lives in-memory on STATE.creatureMotion[world][id]
// (_affect/_drives/_released, written by the tickFlock overlay). This heartbeat
// batch-flushes the SALIENCE-CROSSING ones (a real fright, a triumphant hunt) into
// creature_affect_trace (mig 326), peak-end selected per world so it never floods,
// and mints a kind='affect_memory' DTU for the top-K ("the deer remembers the meadow
// as a place of fear").
//
// Heartbeat contract: always returns a plain { ok, ... }; NEVER throws. scope:'world'.
// Kill-switch CONCORD_AFFECT_TRACE=0.

import crypto from "node:crypto";
import { driftFromFeltPeak } from "../lib/ecosystem/temperament.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

const AROUSAL_TRACE = 0.6;   // arousal at/above this is worth remembering
const CREATURE_PLASTICITY = 0.4; // creatures keep moderate lifelong plasticity
const DRIVE_TRACE = 0.7;     // a dominant drive this strong is worth remembering
const MAX_PER_WORLD = 8;     // peak-end cap per world per pass (no flood)
const MINT_TOP_K = 2;        // how many of the strongest get an affect_memory DTU

function enabled() {
  return process.env.CONCORD_AFFECT_TRACE !== "0";
}

// Is this creature's current felt state worth committing to memory?
function salienceOf(m) {
  if (!m || !m._affect) return 0;
  const arousal = Number(m._affect.a) || 0;
  const driveVal = m._drives && m._dominantDrive ? (Number(m._drives[m._dominantDrive]) || 0) : 0;
  const released = m._released ? 0.2 : 0;
  // a strongly-negative valence is itself salient (fear/pain memories stick)
  const valenceMag = Math.abs(Number(m._affect.v) || 0);
  return Math.max(arousal, driveVal >= DRIVE_TRACE ? driveVal : 0) + released + 0.2 * valenceMag;
}

export function runAffectTraceCycle({ db, state } = {}) {
  if (!enabled()) return { ok: true, reason: "disabled", flushed: 0, minted: 0 };
  if (!db || !state || !state.creatureMotion) return { ok: true, reason: "no_state", flushed: 0, minted: 0 };

  let flushed = 0;
  let minted = 0;
  try {
    for (const worldId of Object.keys(state.creatureMotion)) {
      const store = state.creatureMotion[worldId];
      if (!store) continue;

      // collect salience-crossing candidates for this world
      const candidates = [];
      for (const creatureId of Object.keys(store)) {
        const m = store[creatureId];
        const sal = salienceOf(m);
        if (sal >= AROUSAL_TRACE) candidates.push({ creatureId, m, sal });
      }
      if (candidates.length === 0) continue;

      // peak-end: keep the strongest few (the peaks), not every twitch
      candidates.sort((a, b) => b.sal - a.sal);
      const kept = candidates.slice(0, MAX_PER_WORLD);

      const insert = db.prepare(`
        INSERT INTO creature_affect_trace
          (id, world_id, creature_id, species_id, v, a, dominant_drive, drive_value,
           intensity, reason, fap, x, z, dtu_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `);

      kept.forEach((c, idx) => {
        const m = c.m;
        const drive = m._dominantDrive || null;
        const driveVal = drive && m._drives ? (Number(m._drives[drive]) || 0) : null;
        // mint an affect_memory DTU for the top-K strongest (best-effort)
        let dtuId = null;
        if (idx < MINT_TOP_K) {
          dtuId = mintAffectMemory(db, worldId, c, drive);
          if (dtuId) minted++;
        }
        // Wave 7 / A6 plasticity — a strong felt peak drifts the creature's
        // temperament (a frightened deer becomes warier over its life). The same
        // peaks that become memory also edit personality. Bounded + guarded.
        if (drive) driftCreatureTemperament(db, c.creatureId, drive, c.sal);
        try {
          insert.run(
            `aff_${crypto.randomBytes(6).toString("hex")}`,
            worldId, c.creatureId, m._species || null,
            Number(m._affect.v) || 0, Number(m._affect.a) || 0,
            drive, driveVal, Math.min(1, c.sal),
            reasonFor(m), m._released || null,
            Number(m.x) || null, Number(m.z) || null, dtuId,
          );
          flushed++;
        } catch { /* per-row skip (table optional / shape mismatch) */ }
      });
    }
  } catch (err) {
    return { ok: true, reason: `error:${err?.message || "unknown"}`, flushed, minted };
  }
  return { ok: true, flushed, minted };
}

// A6 plasticity write-back: drift a creature's persisted temperament toward the
// drive it just felt strongly. Column-optional (mig 326); never throws.
function driftCreatureTemperament(db, creatureId, dominantDrive, intensity) {
  try {
    const row = db.prepare(`SELECT temperament_json FROM world_npcs WHERE id = ?`).get(creatureId);
    if (!row) return;
    let temperament = null;
    try { temperament = row.temperament_json ? JSON.parse(row.temperament_json) : null; } catch { temperament = null; }
    // seed a flat baseline if the creature has none yet
    if (!temperament || typeof temperament !== "object") {
      temperament = {}; for (const k of DRIVE_KINDS) temperament[k] = 0.3;
    }
    const drifted = driftFromFeltPeak(temperament, { dominantDrive, intensity: Math.min(1, intensity) }, CREATURE_PLASTICITY);
    if (DRIVE_KINDS.every((k) => Number.isFinite(drifted[k]))) {
      db.prepare(`UPDATE world_npcs SET temperament_json = ? WHERE id = ?`).run(JSON.stringify(drifted), creatureId);
    }
  } catch { /* column/table optional — never blocks the flush */ }
}

function reasonFor(m) {
  if (m._released) return m._released;
  if (m._dominantDrive) return m._dominantDrive.toLowerCase();
  return (Number(m._affect?.v) || 0) < 0 ? "distress" : "arousal";
}

function mintAffectMemory(db, worldId, c, drive) {
  try {
    const dtuId = `dtu_affmem_${crypto.randomBytes(6).toString("hex")}`;
    const v = Number(c.m._affect.v) || 0;
    const place = (Number.isFinite(c.m.x) && Number.isFinite(c.m.z)) ? ` at (${Math.round(c.m.x)}, ${Math.round(c.m.z)})` : "";
    const tone = v < -0.3 ? "a place of fear" : v > 0.3 ? "a place of plenty" : "a place that mattered";
    const human = `The ${c.m._species || "creature"} remembers${place} as ${tone}.`;
    const data = {
      human,
      core: { kind: "affect_memory", species: c.m._species, valence: v, drive },
      machine: { tags: ["affect_memory", "creature"], composer: "affect_trace" },
    };
    db.prepare(`
      INSERT INTO dtus (id, creator_id, world_id, kind, title, data, created_at)
      VALUES (?, ?, ?, 'affect_memory', ?, ?, unixepoch())
    `).run(dtuId, c.creatureId, worldId, "Affect memory", JSON.stringify(data));
    return dtuId;
  } catch {
    return null; // dtus schema mismatch / minimal build
  }
}

export const _internal = { salienceOf, AROUSAL_TRACE, MAX_PER_WORLD };
