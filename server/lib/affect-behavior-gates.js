// server/lib/affect-behavior-gates.js
//
// Wave B / B3 — pure gate functions that turn affect state (E from
// server/affect/engine.js) into NPC behavior overrides. Affect tracks
// v (valence), a (arousal), c (calmness), g (groundedness), t (trust),
// f (focus) in [-1, +1].
//
// All gates are PURE — they take an affect state and return a decision
// without writing anything. Callers (npc-routines, quest-accept route,
// combat skill picker, dialogue composer) read the gates and apply.
//
// Tunable thresholds live in this module + are exported for tests.

export const GATE_THRESHOLDS = Object.freeze({
  // Grief: very low valence + low arousal (numb sorrow).
  GRIEF_V: -0.45,
  GRIEF_A: 0.20,             // arousal low (≤ this)
  // Fear: low valence + high arousal.
  FEAR_V: -0.20,
  FEAR_A: 0.45,              // arousal high (≥ this)
  // Despair: very low valence + low calmness + low groundedness.
  DESPAIR_V: -0.55,
  DESPAIR_C: 0.00,           // calmness ≤ this
  DESPAIR_G: 0.00,           // groundedness ≤ this
  // Rage: low-mid valence + high arousal + low calmness.
  RAGE_V_MAX: 0.10,
  RAGE_A: 0.55,
  RAGE_C_MAX: -0.05,
  // Joy: high valence + high calmness.
  JOY_V: 0.50,
  JOY_C: 0.30,
});

/** True if the NPC's affect should override their scheduled routine into 'rest'. */
export function shouldSkipRoutine(affect) {
  if (!affect) return false;
  const t = GATE_THRESHOLDS;
  const grief = affect.v <= t.GRIEF_V && affect.a <= t.GRIEF_A;
  const fear  = affect.v <= t.FEAR_V  && affect.a >= t.FEAR_A;
  return grief || fear;
}

/** Decision shape: { allow: boolean, reason?: string, mood?: string } */
export function canAcceptQuest(affect, _relational = null) {
  if (!affect) return { allow: true };
  const t = GATE_THRESHOLDS;
  // Full despair = refuse outright.
  if (affect.v <= t.DESPAIR_V && affect.c <= t.DESPAIR_C && affect.g <= t.DESPAIR_G) {
    return { allow: false, reason: "despair", mood: "grieving" };
  }
  // Grief or strong fear = refuse new burdens but explain.
  if (shouldSkipRoutine(affect)) {
    return { allow: false, reason: affect.a <= t.GRIEF_A ? "grief" : "fear", mood: affect.a <= t.GRIEF_A ? "grieving" : "fearful" };
  }
  return { allow: true };
}

/**
 * Returns weights summing to ~1 for { offense, defense, utility }.
 * Combat code multiplies its skill-pick weights by this bias.
 */
export function pickSkillBias(affect) {
  if (!affect) return { offense: 0.34, defense: 0.33, utility: 0.33 };
  const t = GATE_THRESHOLDS;
  // High arousal + low valence is either fear or rage. The discriminator
  // is CALMNESS: uncalm → rage (offense), calm-enough → fear (defense).
  // A frightened NPC clutches its weapon defensively; an enraged one
  // attacks. Both look superficially similar in v/a but feel different
  // in behavior.
  if (affect.a >= t.FEAR_A && affect.v <= t.FEAR_V) {
    if (affect.c <= t.RAGE_C_MAX) return { offense: 0.65, defense: 0.20, utility: 0.15 };
    return                              { offense: 0.18, defense: 0.62, utility: 0.20 };
  }
  // Joy → utility (heals, buffs).
  if (affect.v >= t.JOY_V && affect.c >= t.JOY_C) {
    return { offense: 0.25, defense: 0.25, utility: 0.50 };
  }
  // Default balanced.
  return { offense: 0.34, defense: 0.33, utility: 0.33 };
}

/**
 * Returns a short string the LLM dialogue composer prepends to the
 * prompt. Empty string when no override needed.
 */
export function dialogueToneOverride(affect) {
  if (!affect) return "";
  const t = GATE_THRESHOLDS;
  if (affect.v <= t.DESPAIR_V && affect.c <= t.DESPAIR_C && affect.g <= t.DESPAIR_G) {
    return "Your tone is hollow and detached; you struggle to finish sentences.";
  }
  if (affect.v <= t.GRIEF_V && affect.a <= t.GRIEF_A) {
    return "Your tone is quiet and heavy; you sound like you're carrying loss.";
  }
  if (affect.v <= t.FEAR_V && affect.a >= t.FEAR_A) {
    return "Your tone is hurried and watchful; you keep checking exits.";
  }
  if (affect.v <= t.RAGE_V_MAX && affect.a >= t.RAGE_A && affect.c <= t.RAGE_C_MAX) {
    return "Your tone is clipped and impatient; you keep your hand near your weapon.";
  }
  if (affect.v >= t.JOY_V && affect.c >= t.JOY_C) {
    return "Your tone is warm and easy; you laugh at small things.";
  }
  return "";
}

/**
 * Convenience: classify an affect state into one of the moods the
 * dialogue endpoint already surfaces. Tracks the same labels as
 * willNPCInteract (friendly|neutral|suspicious|hostile|grieving|fearful).
 */
export function classifyMood(affect) {
  if (!affect) return "neutral";
  const t = GATE_THRESHOLDS;
  if (affect.v <= t.GRIEF_V && affect.a <= t.GRIEF_A) return "grieving";
  if (affect.v <= t.FEAR_V  && affect.a >= t.FEAR_A)  return "fearful";
  if (affect.v <= t.RAGE_V_MAX && affect.a >= t.RAGE_A && affect.c <= t.RAGE_C_MAX) return "hostile";
  if (affect.v <= -0.15) return "suspicious";
  if (affect.v >= t.JOY_V) return "friendly";
  return "neutral";
}
