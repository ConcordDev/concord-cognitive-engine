// server/emergent/cross-world-scheme-cycle.js
//
// Heartbeat that advances cross-world schemes whose next_tick_at has
// elapsed. Frequency 60 ticks (~15 in-game minutes). Per-scheme
// try/catch so a single failure can never stop the loop.
//
// Boundary discipline: this cycle ONLY operates on cross_world_schemes.
// Single-world schemes (npc-schemes.js) have their own cycle. The two
// state machines never share rows.
//
// Kill switch: each `advanceCrossWorldScheme` call self-gates on the
// kill switch. When paused, every advance returns kill_switch_<mode>
// and the per-scheme record stays where it is (no data loss). When
// flipped back to live, the cycle picks up where it left off.

import {
  listActiveCrossWorldSchemes,
  advanceCrossWorldScheme,
  proposeCrossWorldScheme,
} from "../lib/cross-world-schemes.js";
import { getKillSwitchMode } from "../lib/cross-world-economy.js";

const MAX_PER_PASS = 25;
const PROPOSE_MAX = 3;       // new schemes opened per pass
const PROPOSE_MIN_RESONANCE = 50;

// Open new cross-world schemes along authored RIVAL ties that don't yet have an
// active scheme. proposeCrossWorldScheme self-validates (relationship exists,
// kill-switch live, no duplicate), so this is safe + idempotent; it no-ops when
// no rival relationships are seeded. Intrigue (blackmail), never assassination.
function runProposePass(db) {
  let proposed = 0;
  let rivals = [];
  try {
    rivals = db.prepare(
      `SELECT from_world_id, from_npc_id, to_world_id, to_npc_id
       FROM cross_npc_relationships
       WHERE kind = 'rival' AND resonance_strength >= ?
       ORDER BY resonance_strength DESC LIMIT ?`
    ).all(PROPOSE_MIN_RESONANCE, PROPOSE_MAX * 4);
  } catch {
    return 0; // table absent — nothing to propose
  }
  for (const rel of rivals) {
    if (proposed >= PROPOSE_MAX) break;
    try {
      const r = proposeCrossWorldScheme(db, {
        plotterWorld: rel.from_world_id, plotterId: rel.from_npc_id, plotterKind: "npc",
        targetWorld: rel.to_world_id, targetId: rel.to_npc_id, targetKind: "npc",
        kind: "blackmail",
      });
      if (r.ok) proposed++;
    } catch { /* per-rival isolation */ }
  }
  return proposed;
}

export async function runCrossWorldSchemeCycle({ db }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (getKillSwitchMode(db) !== "live") {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  let advanced = 0;
  let errors = 0;
  try {
    const due = listActiveCrossWorldSchemes(db, { limit: MAX_PER_PASS });
    for (const sch of due) {
      try {
        const r = advanceCrossWorldScheme(db, sch.id);
        if (r.ok && r.transitioned) {
          advanced++;
          // Sprint 8 — broadcast cross-world scheme phase transitions
          // to both worlds' timeline feeds so players see the plot move.
          try {
            const re = globalThis._concordRealtimeEmit;
            if (typeof re === "function") {
              re("scheme:cross_world", {
                world_id: sch.plotter_world_id,
                actor_kind: sch.plotter_kind,
                actor_id: sch.plotter_id,
                scheme_id: sch.id,
                kind: sch.kind,
                from_phase: r.fromPhase,
                to_phase: r.toPhase,
                target_world: sch.target_world_id,
                target_kind: sch.target_kind,
                target_id: sch.target_id,
              });
            }
          } catch { /* never block tick */ }
        }
      } catch {
        errors++;
      }
    }
    const proposed = runProposePass(db);
    return { ok: true, processed: due.length, advanced, errors, proposed };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
