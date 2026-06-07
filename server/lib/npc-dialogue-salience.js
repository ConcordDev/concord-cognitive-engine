// server/lib/npc-dialogue-salience.js
//
// Wave 7 / Track B4 + D1 (dialogue path) — the salience gate for NPC dialogue. Today
// EVERY player↔NPC exchange calls the LLM; that is the broken half of the cost story.
// This decides whether THIS exchange is salient enough to deserve LLM nuance, or
// whether the deterministic composer (npc-dialogue-fallback) already reads as a person.
//
// A calm, neutral, routine greeting → deterministic, ZERO LLM. A charged one — a
// grudge, a desire, hostility, grief, a quest to offer, a conscious NPC, fear/suspicion
// — wakes the LLM. That is "feeling decides when to think" applied to the town: a
// village chatters for free; the brain wakes only when the exchange actually matters.
//
//   npcDialogueSalience(signals) -> { salient, score, reason }
//
// Pure + total. The caller ANDs this with a per-world budget + the CONCORD_AFFECT_SALIENCE
// kill-switch (off → always-LLM, the prior behaviour).

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

const THRESHOLD = 0.4; // at/above this the exchange wakes the LLM

/**
 * @param {object} s {
 *   mood?: 'warm'|'friendly'|'neutral'|'suspicious'|'hostile'|'grieving'|'fearful',
 *   opinion?: number,        // -1..1 the NPC's opinion of this player
 *   isHostileRep?: boolean,  // player is hated/feared
 *   asymmetry?: { grudge?, preoccupation?, desire? } | null,  // presence flags
 *   questCount?: number,     // quests this NPC can offer
 *   griefLevel?: number,     // 0..N
 *   isConscious?: boolean,   // a conscious NPC always deliberates
 * }
 */
export function npcDialogueSalience(s = {}) {
  const sig = s || {};
  let score = 0;
  const reasons = [];

  // a conscious NPC is always worth the brain
  if (sig.isConscious) { score = 1; reasons.push("conscious"); }

  const mood = String(sig.mood || "neutral");
  if (mood === "hostile" || sig.isHostileRep) { score = Math.max(score, 0.9); reasons.push("hostile"); }
  else if (mood === "grieving") { score = Math.max(score, 0.8); reasons.push("grieving"); }
  else if (mood === "fearful" || mood === "suspicious") { score = Math.max(score, 0.6); reasons.push(mood); }

  // an asymmetric charge toward THIS player (a grudge / a quiet want) is salient
  const asym = sig.asymmetry || {};
  if (asym.grudge) { score = Math.max(score, 0.7); reasons.push("grudge"); }
  if (asym.desire) { score = Math.max(score, 0.6); reasons.push("desire"); }
  if (asym.preoccupation) { score = Math.max(score, 0.45); reasons.push("preoccupation"); }

  // something to actually transact (a quest) is worth a real reply
  if (Number(sig.questCount) > 0) { score = Math.max(score, 0.6); reasons.push("quest_offer"); }

  if (Number(sig.griefLevel) > 0) { score = Math.max(score, 0.5); reasons.push("grief"); }

  // a strong opinion either way (love or loathing) is more than small talk
  const op = Math.abs(Number(sig.opinion) || 0);
  if (op >= 0.6) { score = Math.max(score, 0.5); reasons.push("strong_opinion"); }

  return {
    salient: score >= THRESHOLD,
    score: clamp01(score),
    reason: reasons[0] || "routine",
  };
}

export const _internal = { THRESHOLD };
