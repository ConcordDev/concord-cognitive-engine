// server/lib/npc-backstory.js
//
// Phase H — procedural NPC backstory composer.
//
// Two paths:
//   - composeDeterministicBackstory(npc, faction, world) — always available,
//     no LLM dependency. Stitches grounded prose from archetype + faction
//     + world flavor + bloodline dilution. Stable across restarts (seeded
//     by npc.id).
//   - composeLlmBackstory(npc, faction, world, llm) — opt-in via
//     CONCORD_PROCGEN_BACKSTORY_LLM=true. Routes through the subconscious
//     brain with a tight 6-sentence template. On any failure or 8s
//     timeout, falls back to the deterministic composer.
//
// The composer never invents events the NPC didn't have — it only
// describes their position in the world (faction, archetype, bloodline,
// climate context).

import crypto from "node:crypto";

// Deterministic RNG seeded by NPC id so the same NPC always gets the same
// backstory, no matter how many times the function is called.
function seededRng(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  let s = (h >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const ARCHETYPE_OPENERS = {
  warrior:  ["A blade in service of", "Drawn early into the fights of", "A sword-arm shaped by"],
  scholar:  ["Raised in the libraries of", "Spent years among the scribes of", "Apprenticed to the lore-keepers of"],
  trader:   ["Born to the caravans of", "Cut their first deal at the markets of", "Walked the trade roads of"],
  mystic:   ["Touched by the unseen at the rites of", "Trained in the secret orders of", "Whose dreams were claimed by"],
  guard:    ["Sworn to the gates of", "Wore the colors of", "Drilled in the watch-houses of"],
  healer:   ["Apprenticed in the houses of healing of", "Walked the sick-roads of", "Learned the old salves from"],
  hunter:   ["Tracked their first quarry across", "Knows the wild paths of", "Whose snares feed"],
  default:  ["Made their first mark among", "A familiar face in", "Found their way through"],
};

const DILUTION_PHRASES = {
  near:     ["a direct descendant of", "the unmistakable bloodline of", "carries the bearing of"],
  mid:      ["a great-grandchild of", "kin to", "whose family tree shadows"],
  far:      ["a distant cousin of", "shares only old blood with", "the faintest echo of"],
};

const WORLD_FLAVOR_HINTS = {
  "tunya":            "where the long rains and the green hours shape every choice",
  "sovereign-ruins":  "where what's left was once more, and silence is its own god",
  "crime":            "where every street has a price and every door has two locks",
  "cyber":            "where the neon never sleeps and the corps own the air",
  "superhero":        "where headlines change in ninety seconds and the cape is the law",
  "fantasy":          "where thee and thou are still the words for any honest exchange",
  "lattice-crucible": "where every move is iteration and the lattice records it all",
  "concordia-hub":    "the city of the four-faction Compact, where all roads meet",
};

/**
 * Generate a deterministic backstory for an NPC. Stable on repeat calls
 * (seeded by npc.id). Returns a 4-6 sentence prose paragraph.
 *
 * @param {object} npc - { id, archetype, factionId, ancestry? }
 * @param {object} [faction] - { displayName, id }
 * @param {object} [world] - { worldId, voiceTone? }
 * @returns {string}
 */
export function composeDeterministicBackstory(npc, faction = null, world = null) {
  const rng = seededRng(String(npc?.id ?? "unknown"));
  const archetype = (npc?.archetype ?? "default").toLowerCase();
  const factionName = faction?.displayName ?? faction?.id ?? npc?.factionId ?? "unaffiliated";
  const worldHint = WORLD_FLAVOR_HINTS[world?.worldId] ?? "where their work continues quietly";
  const openers = ARCHETYPE_OPENERS[archetype] ?? ARCHETYPE_OPENERS.default;
  const opener = openers[Math.floor(rng() * openers.length)];

  // Bloodline sentence (only if ancestry present).
  let bloodlineSentence = "";
  if (npc?.ancestry?.primary_bloodline) {
    const dilution = Number(npc.ancestry.dilution ?? 1.0);
    const tier = dilution >= 0.75 ? "near" : dilution >= 0.4 ? "mid" : "far";
    const phrases = DILUTION_PHRASES[tier];
    bloodlineSentence = `Carries the bloodline of ${phrases[Math.floor(rng() * phrases.length)]} ${npc.ancestry.primary_bloodline}.`;
  }

  // Two-trait sentence from npc.asymmetry if present.
  let traitSentence = "";
  if (npc?.preoccupation || npc?.desire) {
    const traits = [];
    if (npc.preoccupation) traits.push(`preoccupied with ${npc.preoccupation}`);
    if (npc.desire) traits.push(`quietly wants ${npc.desire}`);
    if (traits.length) traitSentence = `Lately ${traits.join(", and ")}.`;
  }

  // Final composed prose.
  const parts = [
    `${opener} ${factionName}, ${worldHint}.`,
    bloodlineSentence,
    traitSentence,
    "Not famous. Not nobody. Real."
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * LLM-enhanced backstory. Opt-in via CONCORD_PROCGEN_BACKSTORY_LLM=true.
 * Falls back to deterministic on failure or timeout.
 *
 * @param {object} npc
 * @param {object} faction
 * @param {object} world
 * @param {object} llm - { chat: ({messages, brain, timeoutMs}) => Promise<{ok, text}> }
 * @returns {Promise<string>}
 */
export async function composeLlmBackstory(npc, faction, world, llm) {
  if (process.env.CONCORD_PROCGEN_BACKSTORY_LLM !== "true") {
    return composeDeterministicBackstory(npc, faction, world);
  }
  if (!llm || typeof llm.chat !== "function") {
    return composeDeterministicBackstory(npc, faction, world);
  }
  const det = composeDeterministicBackstory(npc, faction, world);
  const fingerprint = crypto.createHash("sha1")
    .update(`${npc.id}|${npc.archetype}|${faction?.id}|${world?.worldId}`)
    .digest("hex").slice(0, 8);
  const system = `You are a worldbuilding assistant. Compose a 4-6 sentence backstory paragraph for an NPC who lives in a simulated world. The voice should match the world's tone. Never invent events outside the supplied facts. Output plain prose, no preamble.`;
  const user = `Facts:
- World: ${world?.worldId ?? "unknown"}
- World tone: ${world?.voiceTone ?? "neutral"}
- Faction: ${faction?.displayName ?? faction?.id ?? "unaffiliated"}
- Archetype: ${npc?.archetype ?? "default"}
- Bloodline: ${npc?.ancestry?.primary_bloodline ?? "none"} (dilution ${npc?.ancestry?.dilution ?? 1.0})
- Preoccupation: ${npc?.preoccupation ?? "none"}
- Desire: ${npc?.desire ?? "none"}
- Fingerprint (use as deterministic flavor anchor): ${fingerprint}

A seed paragraph from the deterministic composer (rewrite in the world's voice; do NOT add events):
"""
${det}
"""`;
  try {
    const r = await Promise.race([
      llm.chat({
        brain: "subconscious",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        timeoutMs: 8000,
      }),
      new Promise((_, reject) => { setTimeout(() => reject(new Error("llm_backstory_timeout")), 8000); }),
    ]);
    if (r?.ok && typeof r.text === "string" && r.text.length > 20) {
      return r.text.trim();
    }
  } catch { /* fall through */ }
  return det;
}
