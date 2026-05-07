// server/lib/combat/boss-phases.js
//
// Generalized boss-fight phase transition wrapper, extracted from the
// Sovereign Mass Raid pattern (lib/sovereign/raid-event.js#maybeAdvancePhase).
//
// Any boss can now declare phase thresholds + per-phase refusal fields
// + per-phase scaling factor + onEnter hook + onExit hook. Phase
// progression is driven by an arbitrary metric (HP%, participant count,
// time-elapsed, dome integrity) so different bosses can use different
// triggers without each re-implementing the scaffold.
//
// Usage:
//   import { createBossPhases } from "./boss-phases.js";
//   const phases = createBossPhases({
//     bossId: "concordia_first_boss",
//     worldId: "concordia-hub",
//     phases: [
//       { name: "intro",   when: ({ hpPct }) => hpPct > 0.75, refusals: [], scaling: 1.0 },
//       { name: "tested",  when: ({ hpPct }) => hpPct > 0.50, refusals: ["consequence_held"], scaling: 1.4 },
//       { name: "wrath",   when: ({ hpPct }) => hpPct > 0.20, refusals: ["death_suspended"],  scaling: 2.0 },
//       { name: "broken",  when: ()        => true,            refusals: [],                  scaling: 3.5 },
//     ],
//     onPhaseEnter: (phase) => realtimeEmit("boss:phase-enter", { bossId, phase: phase.name }),
//   });
//   // Each combat tick:
//   phases.tick({ hpPct: hp/maxHp, participants: 5 });

import { applyTemporaryRefusal } from "../refusal-field.js";

/**
 * @param {object} opts
 * @param {string} opts.bossId
 * @param {string} opts.worldId
 * @param {Array<{ name: string, when: (metric: object) => boolean, refusals?: string[], scaling?: number, durationMs?: number }>} opts.phases
 * @param {(phase: object) => void} [opts.onPhaseEnter]
 * @param {(phase: object) => void} [opts.onPhaseExit]
 * @param {object} [opts.state]  — pass `STATE` so refusal fields land in the same store
 */
export function createBossPhases({
  bossId,
  worldId = "concordia-hub",
  phases = [],
  onPhaseEnter = null,
  onPhaseExit = null,
  state = null,
} = {}) {
  if (!bossId) throw new Error("bossId required");
  if (!Array.isArray(phases) || phases.length === 0) throw new Error("phases required");

  let currentIdx = -1;
  const declaredRefusals = []; // { phaseName, refusalIds }

  function _enter(idx, metric) {
    const phase = phases[idx];
    currentIdx = idx;
    // Declare the phase's signature refusal fields. They auto-expire via
    // the refusal-field-sweep heartbeat. If state isn't supplied, skip.
    const refusalIds = [];
    if (state && Array.isArray(phase.refusals) && phase.refusals.length > 0) {
      const dur = Number(phase.durationMs) || 30 * 60 * 1000;
      for (const kind of phase.refusals) {
        try {
          const entry = applyTemporaryRefusal(state, worldId, kind, {
            durationMs: dur,
            reason: `boss_${bossId}_${phase.name}`,
          });
          if (entry?.id) refusalIds.push(entry.id);
        } catch { /* refusal field unavailable — skip */ }
      }
    }
    declaredRefusals.push({ phaseName: phase.name, refusalIds });
    if (typeof onPhaseEnter === "function") {
      try { onPhaseEnter({ ...phase, bossId, worldId, metric }); } catch { /* hook is best-effort */ }
    }
  }

  function _exit(idx) {
    if (idx < 0) return;
    const phase = phases[idx];
    if (typeof onPhaseExit === "function") {
      try { onPhaseExit({ ...phase, bossId, worldId }); } catch { /* hook is best-effort */ }
    }
  }

  /**
   * Advance the phase based on the current metric.
   * @returns {{ phase: string|null, advanced: boolean }}
   */
  function tick(metric = {}) {
    let nextIdx = -1;
    // First phase whose `when` predicate is true is the new current phase.
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      try {
        if (p.when(metric)) {
          nextIdx = i;
          break;
        }
      } catch { /* predicate threw — skip */ }
    }
    if (nextIdx === -1) return { phase: phases[currentIdx]?.name || null, advanced: false };
    if (nextIdx === currentIdx) return { phase: phases[currentIdx].name, advanced: false };
    _exit(currentIdx);
    _enter(nextIdx, metric);
    return { phase: phases[currentIdx].name, advanced: true };
  }

  function currentPhase() {
    if (currentIdx < 0) return null;
    const p = phases[currentIdx];
    return { name: p.name, scaling: p.scaling ?? 1.0, refusals: p.refusals || [] };
  }

  function scaling() {
    return phases[currentIdx]?.scaling ?? 1.0;
  }

  return { tick, currentPhase, scaling, declaredRefusals };
}
