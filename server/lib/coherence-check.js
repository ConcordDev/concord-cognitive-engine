// server/lib/coherence-check.js
//
// Coherence check for procedural creations before they hit the substrate.
// Wraps the repair-brain prompt vet with structural world-state queries
// (timeline, faction policy, NPC registry, world clock) so a procedural
// NPC line, quest stub, or evo-asset can't claim things contradicting
// live world state.
//
// Pre-this-module the repair-brain caught dialogue tone / safety issues
// but not factual coherence. Procedural mints could (and silently did)
// reference dormant Sovereign exemptions, dead NPCs, dissolved factions,
// or the wrong time of day. This module is the structural guard that
// sits beside repair-brain.
//
// Usage:
//   import { checkCoherence } from "./coherence-check.js";
//   const result = await checkCoherence(db, {
//     text: "...",
//     contextHints: { factionIds, npcIds, worldId, timeOfDay },
//     strictness: "warn" | "block",
//   });
//   if (!result.ok) { ... regenerate or downgrade ... }
//
// Pure-ish: does DB reads but no DB writes. Best-effort: any module load
// failure short-circuits to ok=true so coherence check never blocks the
// pipeline by being unavailable.

import { getAuthoredNPC, getAuthoredFaction } from "./content-seeder.js";

/**
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.text                — the procedural string about to be committed
 * @param {object} [opts.contextHints]      — { factionIds?, npcIds?, worldId?, timeOfDay?, weather? }
 * @param {"warn"|"block"} [opts.strictness="warn"]
 * @returns {Promise<{ ok: boolean, violations: string[], warnings: string[] }>}
 */
export async function checkCoherence(db, {
  text = "",
  contextHints = {},
  strictness = "warn",
} = {}) {
  const violations = [];
  const warnings   = [];

  if (!text || typeof text !== "string") {
    return { ok: true, violations, warnings };
  }

  // ── Guard 1: referenced NPCs must exist + be in the right world. ──
  for (const npcId of contextHints.npcIds || []) {
    const npc = getAuthoredNPC(npcId);
    if (!npc) {
      warnings.push(`coherence:unknown_npc:${npcId}`);
      continue;
    }
    const npcWorld = npc.home_world ?? null;
    if (contextHints.worldId && npcWorld && npcWorld !== contextHints.worldId) {
      violations.push(`coherence:npc_wrong_world:${npcId}:expected=${contextHints.worldId},actual=${npcWorld}`);
    }
  }

  // ── Guard 2: referenced factions must exist. ──
  for (const factionId of contextHints.factionIds || []) {
    const faction = getAuthoredFaction(factionId);
    if (!faction) {
      warnings.push(`coherence:unknown_faction:${factionId}`);
      continue;
    }
    // If the procedural text references a recent faction policy, check it
    // matches the current state. We do a soft substring match — formal
    // entity-name vs. text token alignment is the LLM's job.
    if (db && /\b(referendum|ruling|policy|decree)\b/i.test(text)) {
      try {
        const { getFactionPolicyState } = await import("./council-world-bridge.js");
        const history = getFactionPolicyState(db, factionId);
        if (!history || history.length === 0) {
          warnings.push(`coherence:faction_policy_referenced_but_none:${factionId}`);
        }
      } catch { /* council bridge unavailable — skip */ }
    }
  }

  // ── Guard 3: time-of-day / weather phrasing must match world state. ──
  // Only flag obvious contradictions (text says "morning" but worldClock
  // says it's night). Soft check; lots of fiction-writing styles use
  // mixed tenses.
  if (contextHints.timeOfDay) {
    const tod = String(contextHints.timeOfDay).toLowerCase();
    const lower = text.toLowerCase();
    const dayWords  = ["morning", "midday", "noon", "afternoon", "dawn"];
    const nightWords = ["night", "dusk", "midnight", "evening"];
    const isDay   = ["dawn", "morning", "midday", "afternoon"].includes(tod);
    const isNight = ["evening", "night", "midnight"].includes(tod);
    if (isDay && nightWords.some((w) => lower.includes(w))) {
      warnings.push(`coherence:time_mismatch:world=${tod},text=night-phrasing`);
    }
    if (isNight && dayWords.some((w) => lower.includes(w))) {
      warnings.push(`coherence:time_mismatch:world=${tod},text=day-phrasing`);
    }
  }

  // ── Guard 4: weather phrasing must match. ──
  if (contextHints.weather) {
    const weather = String(contextHints.weather).toLowerCase();
    const lower = text.toLowerCase();
    if (weather === "clear" && /(rain|storm|snow|blizzard|hail)/i.test(text)) {
      warnings.push(`coherence:weather_mismatch:world=clear,text-mentions-precipitation`);
    }
    if (/^(rain|storm)/.test(weather) && /sunny|clear sky|cloudless/i.test(lower)) {
      warnings.push(`coherence:weather_mismatch:world=${weather},text=clear-phrasing`);
    }
  }

  // ── Guard 5: cross-NPC shared facts (world_facts table). ──
  // Pull recent world facts and check that any factual assertion in the
  // text doesn't directly contradict them. This is a substring proximity
  // check rather than a full NLU — coarse but cheap and zero-LLM.
  if (db && contextHints.worldId) {
    try {
      const facts = db.prepare(`
        SELECT fact_text FROM world_facts
        WHERE world_id = ? AND expires_at > unixepoch()
        ORDER BY recorded_at DESC LIMIT 30
      `).all(contextHints.worldId);
      for (const f of (facts || [])) {
        // Simple negation detection: text says "no convoy" but a fact
        // mentions a convoy. This is intentionally low-precision; the
        // coherence system can be tightened over time.
        if (/\bno\s+(\w+)/i.test(text)) {
          const m = text.match(/\bno\s+(\w+)/i);
          const noun = m && m[1] ? m[1].toLowerCase() : "";
          if (noun && f.fact_text && f.fact_text.toLowerCase().includes(noun)) {
            warnings.push(`coherence:negation_vs_fact:noun=${noun}`);
          }
        }
      }
    } catch { /* world_facts table not present in this build */ }
  }

  // ── Guard 6: optional repair-brain pre-flight on the seed text. ──
  // Repair-brain provides safety / quality vetting; coherence-check
  // delegates to it for the soft "does this read like dialogue" pass.
  try {
    const rb = await import("./repair-brain.js");
    if (rb.vetNPCDialogue && contextHints.npcIds?.length > 0) {
      const npc = getAuthoredNPC(contextHints.npcIds[0]) || { id: contextHints.npcIds[0] };
      const vet = await rb.vetNPCDialogue(text.slice(0, 1500), npc);
      if (vet?.score !== null && vet?.score < (rb.REPAIR_DEFAULT_FLOOR?.dialogue ?? 0.5)) {
        warnings.push(`coherence:repair_brain_low_score:${vet.score}`);
      }
    }
  } catch { /* repair brain unavailable — fail open */ }

  // Strict mode promotes warnings into violations.
  if (strictness === "block") {
    violations.push(...warnings.splice(0, warnings.length));
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
  };
}
