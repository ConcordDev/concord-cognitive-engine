// server/lib/npc-dialogue-fallback.js
//
// POLISH_AUDIT T1.1 — deterministic NPC dialogue fallback.
//
// The /dialogue endpoint always calls the LLM; when Ollama is down/slow or
// returns un-parseable output the fallback was a flat 1-line greeting from
// npc-relations (12 hardcoded lines, 2 per mood, no body) — so on any box
// without a fast LLM every NPC collapsed to "Mmhm." The rich grounding the
// route already loads (archetype, mood, current activity, asymmetry, faction,
// reputation tier) was fed ONLY to the LLM and discarded on fallback.
//
// This composes a grounded greeting + subtext from that SAME context,
// deterministically (no RNG — keyed by npc id + mood so it's stable and
// testable). It NEVER touches secrets — only the kind of a grudge/desire and
// the public-facing activity/faction/reputation, mirroring the asymmetry
// context's own privacy stance.

const MOODS = ["friendly", "neutral", "suspicious", "hostile", "grieving", "fearful"];

// Per-mood greeting templates. {name} / {act} / {fac} are filled when known.
const GREETINGS = {
  friendly: [
    "Good to see a friendly face. What brings you my way?",
    "Ah — you. Sit a moment, I've time for you.",
    "Well met. I was just {act}; glad of the company.",
  ],
  neutral: [
    "You need something?",
    "I'm {act}, but I can spare a word. Speak.",
    "State your business and I'll hear it.",
  ],
  suspicious: [
    "I know your sort. What do you really want?",
    "Keep your hands where I can see them and talk.",
    "You're not from around the {fac}. Why approach me?",
  ],
  hostile: [
    "You've a nerve, showing your face to me.",
    "Say your piece and be gone before I make you regret it.",
    "I've nothing for the likes of you.",
  ],
  grieving: [
    "Forgive me — my mind's elsewhere. What is it?",
    "I'm not myself today. Be quick.",
    "Grief sits heavy. Still — speak, if you must.",
  ],
  fearful: [
    "Not so loud. They could be listening.",
    "Quickly, before someone sees us together.",
    "I shouldn't be talking to anyone. What do you want?",
  ],
};

// Archetype flavour prefixes woven into the greeting for distinctness.
const ARCHETYPE_VOICE = {
  warrior: "hand resting on a hilt", guard: "eyes scanning the road", scholar: "marking a page",
  trader: "tallying coin", mystic: "tracing a sigil in the air", healer: "wiping clean hands",
  hunter: "testing a bowstring", cyber: "a readout flickering across one eye", default: "",
};

const ACTIVITY_PHRASE = {
  training: "running drills", patrol: "walking my round", trade: "minding the stall",
  craft: "at my work", socialize: "passing the time", commune: "at my devotions",
  sleep: "half-asleep", rest: "taking a breather", idle: "between tasks",
};

function hash(str) {
  let h = 0;
  const s = String(str || "x");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function normMood(mood, isHostile) {
  if (isHostile) return "hostile";
  const m = mood === "warm" ? "friendly" : mood;
  return MOODS.includes(m) ? m : "neutral";
}

/**
 * Compose a grounded greeting + subtext deterministically from the context the
 * route already has. Inputs are all optional; the function degrades to a plain
 * but mood-appropriate line.
 *
 * @returns { greeting, subtext, mood }
 */
export function composeDeterministicDialogue(ctx = {}) {
  const {
    npcId, npcName, archetype = "default", faction = null, mood = "neutral",
    isHostileRep = false, currentActivity = null, reputationTier = null,
    asymmetry = null, // { grudge?:string, desire?:string, preoccupation?:string } — short labels, never secrets
    questCount = 0,
  } = ctx;

  const m = normMood(mood, isHostileRep);
  const pool = GREETINGS[m] || GREETINGS.neutral;
  const seed = hash(`${npcId || npcName || "npc"}|${m}`);
  let greeting = pool[seed % pool.length];

  const actWord = ACTIVITY_PHRASE[currentActivity] || ACTIVITY_PHRASE.idle;
  greeting = greeting
    .replace("{act}", actWord)
    .replace("{fac}", faction ? String(faction).replace(/_/g, " ") : "guilds");

  // Subtext: surface the dominant interiority signal (kind only, never secrets),
  // or fall back to an archetype/activity beat — so the line reads as a person.
  let subtext = null;
  const g = asymmetry?.grudge, d = asymmetry?.desire, p = asymmetry?.preoccupation;
  if (m === "hostile" && g) subtext = `They haven't forgotten ${String(g).replace(/_/g, " ")}.`;
  else if (m === "grieving") subtext = "Something was lost here, and recently.";
  else if (m === "fearful" && p) subtext = `Preoccupied — ${String(p).replace(/_/g, " ")}.`;
  else if (m === "friendly" && d) subtext = `They want something of you.`;
  else {
    const voice = ARCHETYPE_VOICE[archetype] || ARCHETYPE_VOICE.default;
    if (voice) subtext = `(${voice})`;
    else if (questCount > 0) subtext = "They have work that needs doing.";
    else if (reputationTier && ["honored", "exalted"].includes(reputationTier)) subtext = "Your name carries weight here.";
  }

  return { greeting, subtext: subtext || null, mood: m };
}

export const DIALOGUE_FALLBACK_CONSTANTS = Object.freeze({ MOODS });
