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
} from "../lib/cross-world-schemes.js";
import { getKillSwitchMode } from "../lib/cross-world-economy.js";

const MAX_PER_PASS = 25;

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
    return { ok: true, processed: due.length, advanced, errors };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
