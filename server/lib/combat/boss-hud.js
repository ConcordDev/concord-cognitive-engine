// server/lib/combat/boss-hud.js
//
// E0#3 — boss HP/phase HUD support + lighting up the dormant boss-phase scaling.
//
// A boss is a world_npcs row (npc_type='boss', current_hp/max_hp) with a
// phase-state object created at spawn (spawn.js) and stored in
// STATE.bossPhases. That phase-state was NEVER ticked during combat — the
// scaling it was meant to apply was dead. These pure helpers let the combat
// NPC-hit path tick the phases on each hp change and build the `boss:state`
// payload the BossHealthBar HUD renders (name + HP bar + phase).

/** A world_npcs row is a boss if it's typed as one or has a phase-state. */
export function isBossRow(bossRow, phases) {
  return !!bossRow && (bossRow.npc_type === "boss" || !!phases);
}

/**
 * Tick the boss's phase-state on the new hp and build the realtime payload.
 * Pure aside from advancing the (caller-owned) phases state machine.
 *
 * @returns {{ npcId, worldId, name, hpPct, currentHp, maxHp, phase, phaseAdvanced, defeated }}
 */
export function computeBossState({ npcId, worldId, name, archetype, currentHp, maxHp, phases = null, defeated = false } = {}) {
  const max = Math.max(1, Number(maxHp) || 1);
  const cur = Math.max(0, Math.min(max, Number(currentHp) || 0));
  const hpPct = Math.max(0, Math.min(1, cur / max));

  let phase = null;
  let phaseAdvanced = false;
  if (phases && typeof phases.tick === "function") {
    try {
      const r = phases.tick({ hpPct });
      phase = r?.phase ?? null;
      phaseAdvanced = !!r?.advanced;
    } catch { /* phase tick best-effort */ }
  }

  return {
    npcId,
    worldId,
    name: name || archetype || "Boss",
    hpPct,
    currentHp: cur,
    maxHp: max,
    phase,
    phaseAdvanced,
    defeated: !!defeated,
  };
}

/**
 * The discrete phase-transition beat that rides alongside the continuous
 * `boss:state` HUD push. `computeBossState` already ticks the phase machine
 * and reports whether THIS hit crossed a threshold — that transition is
 * exactly the `boss:phase-enter` condition boss-phases.js's usage comment
 * describes, and EmergentEventFeed has always tracked the event with nothing
 * emitting it.
 *
 * Returns `null` when no transition happened, so the caller emits only on a
 * real phase change rather than on every landed hit.
 *
 * Field note: EmergentEventFeed's detail extractor reads
 * text/message/npcName/entityName/title/kind/eventType/weather/condition and
 * then worldId/districtId/cityId — it has NO `name` case. The boss's display
 * name therefore ships as `npcName`, or the feed row renders detail-less.
 *
 * @param {ReturnType<typeof computeBossState>} state
 * @returns {{ npcId, worldId, npcName, phase, hpPct }|null}
 */
export function bossPhaseEnterPayload(state) {
  if (!state || !state.phaseAdvanced || !state.phase) return null;
  return {
    npcId: state.npcId,
    worldId: state.worldId,
    npcName: state.name,
    phase: state.phase,
    hpPct: state.hpPct,
  };
}
