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

// Per-choice deterministic follow-up lines for the /dialogue/respond path.
// PLAYTEST #1: the respond path fell back to a flat "<name> responds to your
// choice." when the brain was unavailable — the opener was given a grounded
// fallback (above) but the follow-up wasn't. These read as a person, keyed off
// the choice + the archetype/job/quest the route already loaded. {name}/{job}/
// {fac} are filled when known; {quest} only for the quest choice.
const RESPONSE_LINES = {
  quest: [
    "Aye, there's work if you've the stomach for it. {quest} Do this and you'll not find me ungrateful.",
    "As it happens, I do need a hand. {quest} Bring it done and we'll talk reward.",
    "You came at the right time. {quest} Say the word and it's yours to take on.",
  ],
  trade: [
    "I deal in what my trade affords — tools of my craft, a few oddments, what the road leaves me. Coin first, then we talk.",
    "Browse, then. What I have is honest goods at an honest price; I've no patience for haggling.",
    "Goods? Some. What a {job} keeps to hand, and a little besides. Show me your purse and I'll show you my wares.",
  ],
  ask_work: [
    "Day to day? It's the same round — rise, see to my work as a {job}, and keep my head down. It pays, mostly.",
    "I do what I'm set to. There's always more of it than there are hours, but a {job}'s lot is steady enough.",
    "My work keeps me busy from first light. Dull to tell, but it's mine, and I do it well.",
  ],
  ask_world: [
    "Word travels slow out here, but I'll tell you what I've heard — the {fac} have been restless, and folk are uneasy with it.",
    "Strange days. They say things stir beyond the walls; whether it's truth or drink talking, I couldn't swear.",
    "If you're after rumor, there's no shortage. Keep your wits about you on the roads — that's my only counsel.",
  ],
  goodbye: [
    "Go well, then. The road's long and the light won't hold.",
    "Off with you. Mind how you go.",
    "We're done? So be it. Don't be a stranger — or do; it's all the same to me.",
  ],
};

/**
 * Compose a grounded follow-up reply deterministically for a dialogue choice,
 * from the same context the /dialogue/respond route already loads. Used when the
 * brain is unavailable or returns empty output, so an LLM-off box still answers
 * in character instead of "<name> responds to your choice."
 *
 * @param {{ npcId?:string, npcName?:string, archetype?:string, job?:string,
 *           faction?:string, choice:string, questTitle?:string }} ctx
 * @returns {string} a 1-2 sentence in-character reply
 */
export function composeDeterministicResponse(ctx = {}) {
  const { npcId, npcName = "They", archetype = "default", job = null,
          faction = null, choice = "ask_world", questTitle = null } = ctx;
  const pool = RESPONSE_LINES[choice] || RESPONSE_LINES.ask_world;
  const seed = hash(`${npcId || npcName}|${choice}`);
  let line = pool[seed % pool.length];
  const jobWord = job && job !== "none" ? String(job).replace(/_/g, " ")
    : (archetype && archetype !== "default" ? String(archetype).replace(/_/g, " ") : "tradesperson");
  const questBit = questTitle ? `There's "${String(questTitle)}" that wants doing.` : "There's a task that wants doing.";
  return line
    .replace("{quest}", questBit)
    .replace("{job}", jobWord)
    .replace("{fac}", faction ? String(faction).replace(/_/g, " ") : "factions hereabouts");
}

export const DIALOGUE_FALLBACK_CONSTANTS = Object.freeze({ MOODS });
