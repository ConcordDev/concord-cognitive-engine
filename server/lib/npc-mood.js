// server/lib/npc-mood.js
//
// Track 3 — mood tells. The NPC's own emotional state (npc_stress + an active
// coping trait) → a coarse, NON-player-specific mood label the nameplate can show
// pre-dialogue (RimWorld "show the consequence"; distinct from the player-specific
// demeanor/grudge path). Pure + total. Shared by the /npcs payload (server) and
// the NPCActivityTag (a frontend mirror reads the same `mood` field).

/** Coarse mood from stress (0–100) + an active coping trait (post-break lock). */
export function moodFromStress(stress, coping) {
  if (coping) return "coping";
  if (stress === null || stress === undefined || stress === "") return null; // Number(null)===0, guard first
  const s = Number(stress);
  if (!Number.isFinite(s)) return null;
  if (s >= 75) return "breaking";
  if (s >= 50) return "tense";
  if (s <= 25) return "content";
  return "neutral";
}

/** Whether a mood is worth surfacing a tell for (neutral/content/null are quiet). */
export function moodHasTell(mood) {
  return mood === "tense" || mood === "breaking" || mood === "coping";
}
