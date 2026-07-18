// server/lib/npc-backstory.js
//
// Phase H — procedural NPC backstory composer.
//
// Two paths:
//   - composeDeterministicBackstory(npc, faction, world) — always available,
//     no LLM dependency. Stitches grounded prose from archetype + faction
//     + world flavor + bloodline dilution + a genre-tagged quirk/rumored-secret
//     pair. Stable across restarts (seeded by npc.id).
//   - composeLlmBackstory(npc, faction, world, llm) — opt-in via
//     CONCORD_PROCGEN_BACKSTORY_LLM=true. Routes through the subconscious
//     brain with a tight 6-sentence template. On any failure or 8s
//     timeout, falls back to the deterministic composer.
//
// The composer never invents events the NPC didn't have — it only
// describes their position in the world (faction, archetype, bloodline,
// climate context).
//
// Genre-tag mechanism (2026-07 depth pass): a runtime-spawned NPC's flavor
// text is drawn from a pool tagged to its world's genre (WORLD_GENRE_TAG →
// TRAIT_POOLS / SECRET_POOLS), not one shared genre-blind pool — a cyberpunk
// NPC never draws a "reveres the Sovereign's First Refusal" line and vice
// versa. The closing line is drawn from a small deterministic pool (CLOSERS)
// instead of a single fixed sentence repeated on every procedural NPC.
// Selection uses only the seeded RNG below — never Math.random — so the same
// npc.id always reproduces the same backstory on every call.

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
  warrior:  ["A blade in service of", "Drawn early into the fights of", "A sword-arm shaped by", "Forged on the training grounds of", "Answered the call to arms of"],
  scholar:  ["Raised in the libraries of", "Spent years among the scribes of", "Apprenticed to the lore-keepers of", "Buried in the archives of", "Trained to question everything by"],
  trader:   ["Born to the caravans of", "Cut their first deal at the markets of", "Walked the trade roads of", "Learned to haggle in the bazaars of", "Built a name for fair dealing in"],
  mystic:   ["Touched by the unseen at the rites of", "Trained in the secret orders of", "Whose dreams were claimed by", "Marked early by the old rites of", "Walked a path few return from, within"],
  guard:    ["Sworn to the gates of", "Wore the colors of", "Drilled in the watch-houses of", "Stood post through the worst nights of", "Rose through the ranks of"],
  healer:   ["Apprenticed in the houses of healing of", "Walked the sick-roads of", "Learned the old salves from", "Trained under the mercy of", "Answered every call for aid within"],
  hunter:   ["Tracked their first quarry across", "Knows the wild paths of", "Whose snares feed", "Learned patience in the wilds beyond", "Reads sign better than most read words, in"],
  default:  ["Made their first mark among", "A familiar face in", "Found their way through", "Grew up in the shadow of", "Carved out a small, steady life in"],
};

const DILUTION_PHRASES = {
  near:     ["a direct descendant of", "the unmistakable bloodline of", "carries the bearing of", "an acknowledged heir of", "raised within the direct line of"],
  mid:      ["a great-grandchild of", "kin to", "whose family tree shadows", "several generations removed from", "distantly raised in the house of"],
  far:      ["a distant cousin of", "shares only old blood with", "the faintest echo of", "a rumored relation of", "little more than a name shared with"],
};

// Multiple flavor variants per world so procedural NPCs don't recite the
// identical sentence — every variant for a given world still carries that
// world's core signature phrase (tests pin this: tunya → "long rains"/"green
// hours", cyber → "neon"/"corps") so the substance is stable, only the
// phrasing varies.
const WORLD_FLAVOR_HINTS = {
  "tunya":                ["where the long rains and the green hours shape every choice", "where the green hours are counted like currency and the long rains never come on schedule", "where even in drought, people plan their year around long rains that used to be certain"],
  "sovereign-ruins":      ["where what's left was once more, and silence is its own god", "where every standing wall remembers a taller one that used to be there", "where survival means learning to read a city that's forgotten its own name"],
  "crime":                ["where every street has a price and every door has two locks", "where nobody asks where the money came from, only where it's going", "where a favor owed is worth more than a favor paid"],
  "cyber":                ["where the neon never sleeps and the corps own the air", "where every signal is logged and the corps sell the silence back to you", "where the neon writes the only history anyone bothers to keep"],
  "superhero":            ["where headlines change in ninety seconds and the cape is the law", "where the sirens never fully stop and someone always answers them", "where the difference between hero and headline is who's still standing after"],
  "fantasy":              ["where thee and thou are still the words for any honest exchange", "where an oath sworn under open sky still means something", "where the old workings are half-remembered and twice as dangerous for it"],
  "lattice-crucible":     ["where every move is iteration and the lattice records it all", "where nothing is final, only the best version run so far", "where the lattice forgets nothing and forgives even less"],
  "concordia-hub":        ["the city of the four-faction Compact, where all roads meet", "the city where the Compact's four factions share one set of streets and few of the same rules", "the hub city, where the Refusal Field hums under every conversation whether anyone notices or not"],
  "concord-link-frontier": ["where the crossing points hum and no map agrees with the last one", "where every threshold is a small negotiation with a world that doesn't know you yet", "where the Concord Link's pull is the only constant anyone can rely on"],
  "sere":                 ["where every debt was engineered and every peace was sold as one", "where the ledger is older than the people forced to read it", "where forgiveness always seems to cost more than the original debt"],
};
const DEFAULT_WORLD_HINT_POOL = ["where their work continues quietly"];

// Maps a worldId to a coarse genre tag so procedural NPCs draw traits and
// secrets appropriate to their setting instead of a single genre-blind pool
// (2026-07 audit finding: hub theology — refusal hymns, First Refusal
// reverence — was bleeding indiscriminately into cyberpunk/crime/superhero
// NPCs). Falls back to "standard" for any unlisted or missing worldId.
const WORLD_GENRE_TAG = {
  "concordia-hub":         "standard",
  "tunya":                 "tunya",
  "sovereign-ruins":       "ruins",
  "crime":                 "crime",
  "cyber":                 "cyber",
  "superhero":             "superhero",
  "fantasy":               "fantasy",
  "lattice-crucible":      "lattice",
  "concord-link-frontier": "frontier",
  "sere":                  "sere",
};
function genreTagFor(worldId) {
  return WORLD_GENRE_TAG[worldId] || "standard";
}

// Per-genre character-quirk pools. 10 tags × 10 entries = 100 distinct traits,
// up from a single genre-blind ~10-entry pool shared by every world.
const TRAIT_POOLS = {
  standard: [
    "counts the Eight Refusals under their breath before difficult conversations",
    "keeps a ledger of small favors owed and never lets one lapse",
    "won't sit with their back to a door",
    "collects pressed flowers from every district they've worked",
    "hums the old refusal hymn without noticing they're doing it",
    "answers questions with a question, out of old habit",
    "keeps their tools in the exact order their mentor taught them",
    "flinches at loud bells, for reasons they don't explain",
    "remembers birthdays better than names",
    "trusts a firm handshake over a written contract",
  ],
  tunya: [
    "reads the wind before speaking, even indoors",
    "waters a potted plant that has no business surviving the drought",
    "keeps a spare waterskin for strangers, no questions asked",
    "sings the caravan-count under their breath while walking",
    "distrusts anyone who's never crossed the dune roads on foot",
    "marks the days since the last real rain on their doorframe",
    "speaks to pack animals like they understand every word",
    "keeps sand from three different provinces in separate pouches",
    "won't start a trade before the sky-watcher's morning call",
    "sleeps facing east, out of habit no one taught them",
  ],
  ruins: [
    "salvages one small object from every ruin they clear, never sells them",
    "talks to the silence like it might answer back",
    "keeps count of the buildings still standing versus fallen",
    "won't say the old city's true name out loud",
    "sketches the skyline from memory, changing it slightly each time",
    "carries a key to a door that no longer exists",
    "measures grief in the number of doors they've had to seal",
    "refuses to walk the same route home twice in a week",
    "keeps a candle lit that no one will admit is a vigil",
    "reads dust patterns like other people read weather",
  ],
  crime: [
    "never orders the same drink twice at the same bar",
    "counts exits before counting money",
    "keeps a second set of books nobody else has seen",
    "trusts silence more than any alibi",
    "remembers every debt down to the coin, forgives none",
    "wears the same coat regardless of season, for the pockets",
    "never signs anything with their real handwriting",
    "keeps a runner's map of the district memorized, not written",
    "smiles wider the angrier they get",
    "won't discuss business where there's a mirror",
  ],
  cyber: [
    "runs a personal firewall audit before falling asleep",
    "keeps an analog notebook because paper can't be hacked",
    "talks to their rig like it's a person, apologizes when it crashes",
    "won't eat printed food, insists on something grown",
    "flinches at flickering neon, an old implant-glitch tell",
    "keeps three burner IDs and forgets which one is real some days",
    "trusts a face-to-face meet over any encrypted channel",
    "hums static under their breath when nervous",
    "collects obsolete hardware nobody else wants",
    "reads corp contracts twice, once for the words and once for what's missing",
  ],
  superhero: [
    "keeps a police scanner running low in the background at all times",
    "counts civilians before counting threats, every time",
    "won't take the mask off in front of people they haven't vetted",
    "keeps a first-aid kit better stocked than their own fridge",
    "reads every headline twice, once for truth and once for spin",
    "trusts a handshake more than a press release",
    "keeps an old photo of the skyline from before it changed",
    "flinches at sirens, then moves toward them anyway",
    "never lets a civilian see them tired",
    "keeps score of promises made to strangers, and keeps every one",
  ],
  fantasy: [
    "won't cross running water without a word of thanks to it",
    "keeps a pressed rune-leaf from their first working",
    "talks to their blade like it has opinions",
    "counts the old prayers on their fingers out of habit",
    "distrusts anyone who's never bled for their craft",
    "keeps salt in every pocket, just in case",
    "reads omens in spilled wine, whether they believe in them or not",
    "won't sleep under a roof they didn't help build",
    "remembers every oath sworn to them, word for word",
    "keeps a second name for emergencies, never says why",
  ],
  lattice: [
    "recomputes yesterday's choices before making today's",
    "keeps a private tally of iterations that didn't survive",
    "distrusts any result that arrived too easily",
    "talks through problems out loud, addressing no one",
    "remembers the lattice's corrections better than its praise",
    "won't commit to a plan without running it twice",
    "keeps a physical notebook to escape the recursion, sometimes",
    "counts convergence cycles the way others count birthdays",
    "trusts a hand-drawn diagram over any simulation",
    "flinches at the word 'final', out of old habit",
  ],
  frontier: [
    "keeps a compass that doesn't point anywhere useful, for luck",
    "counts the worlds they've crossed on a string of beads",
    "trusts a stranger's kindness more since crossing over",
    "won't discuss which world they were born in",
    "keeps a token from every threshold they've passed through",
    "reads unfamiliar constellations like they might still mean something",
    "distrusts anyone who's never felt the link's pull",
    "remembers smells from a world they can't name anymore",
    "keeps two calendars, and trusts neither fully",
    "flinches at the hum just before a crossing",
  ],
  sere: [
    "keeps a private ledger of every debt the system called fair",
    "counts interest rates the way others count blessings",
    "won't sign anything without reading the footnotes twice",
    "remembers every name erased from the record",
    "trusts a handshake less than a witnessed signature",
    "keeps a coin from the old currency, just to remember",
    "reads contracts backward first, to catch what's buried",
    "distrusts anyone too eager to forgive a debt",
    "keeps score of favors that were never really free",
    "flinches at the word 'restructuring'",
  ],
};

// Per-genre rumored-secret pools ({faction}/{world} tokens substituted at
// use). 10 tags × 8 entries = 80 distinct secrets, up from 0 in this file
// (the composer previously had no secret pool of its own at all).
const SECRET_POOLS = {
  standard: [
    "quietly doubts {faction}'s newest charter but hasn't said so aloud",
    "still owes {faction} a favor from before the founding",
    "knows a passage through the old district that isn't on any map",
    "was present the night a Refusal Field first held, and never talks about it",
    "keeps a record {faction} would very much like destroyed",
    "was warned once, by someone who is no longer around to explain why",
    "recognizes a face from a life they claim they never lived",
    "knows exactly which glyph fails first, and hasn't reported it",
  ],
  tunya: [
    "knows where the last true well is, and hasn't told the caravan-masters",
    "carries word from a warlord's table that isn't theirs to carry",
    "watched the ark arrive and has never spoken of what they saw",
    "owes {faction} a debt measured in water, not coin",
    "knows a route through the dune roads that outruns every patrol",
    "buried something during the long drought and has never gone back for it",
    "was told a truth about their bloodline they've chosen not to believe",
    "knows which sky-watcher's count is wrong, and why it's kept that way",
  ],
  ruins: [
    "knows which building is still occupied, and by whom",
    "salvaged something from the fall that {faction} would kill to recover",
    "remembers the city's true name and has sworn never to say it",
    "was the last one out of a district that no longer exists",
    "knows a working door among the sealed ones",
    "keeps a name alive that the record books have already erased",
    "owes {faction} for a debt incurred before the collapse",
    "knows exactly how the silence started, and it wasn't an accident",
  ],
  crime: [
    "skimmed off the top of a job {faction} still thinks was clean",
    "knows where the bodies from the old consolidation are actually buried",
    "is the reason a rival crew went quiet, and no one's connected it yet",
    "owes {faction} a debt they've been paying off in information, not coin",
    "turned informant once, briefly, and was never caught",
    "knows which of {faction}'s books are cooked, and by how much",
    "is hiding from someone who used to trust them completely",
    "knows the real reason the last boss disappeared",
  ],
  cyber: [
    "still has root access {faction} thinks got patched out",
    "sold a data package they never fully read, and it's been bothering them since",
    "knows which corp exec is really running a shell identity",
    "owes {faction} a favor logged nowhere on purpose",
    "was the one who leaked the subnet routes, and has never been traced",
    "keeps a backup of something {faction} ordered deleted",
    "knows the fixer everyone's looking for isn't who they claim to be",
    "is running a second identity {faction} hasn't flagged yet",
  ],
  superhero: [
    "knows a hero's real name and has never once used it",
    "was there the night the accident happened, and remembers it differently than the official story",
    "owes {faction} for a rescue that was never made public",
    "knows which 'hero' is actually on someone's payroll",
    "kept evidence out of a case file to protect someone who didn't deserve it",
    "recognizes the villain's voice from somewhere that has nothing to do with capes",
    "knows the broker arming both sides, and hasn't reported it",
    "was offered power once, said no, and has never told anyone",
  ],
  fantasy: [
    "carries a rune {faction}'s loremasters sealed away for good reason",
    "made an oath they can no longer fully remember making",
    "knows where the reawakened power actually sleeps",
    "owes {faction} a debt sworn in blood, not coin",
    "was pilgrim once to a place that isn't on any sanctioned map",
    "knows the true cost of the working that saved their life",
    "carries a second name given by something that wasn't human",
    "knows which loremaster's seal is already failing",
  ],
  lattice: [
    "remembers an iteration the lattice officially never ran",
    "knows a convergence path {faction} would rather stayed unfound",
    "was present for a correction that shouldn't have been possible",
    "owes {faction} a result they never actually verified",
    "knows which prediction failed and was quietly overwritten",
    "kept a private copy of a cycle the lattice tried to forget",
    "recognizes a pattern that keeps recurring and hasn't reported it",
    "knows exactly where the drift started, and let it continue",
  ],
  frontier: [
    "crossed a threshold {faction} doesn't know is still open",
    "carries a message from a world that no longer answers",
    "knows a crossing point that isn't on the Concord Link's charts",
    "owes {faction} for a passage granted under false pretenses",
    "remembers a name from before the crossing that doesn't fit them anymore",
    "knows why the last envoy never came back",
    "kept something through the crossing that wasn't supposed to survive it",
    "knows which threshold is starting to fail",
  ],
  sere: [
    "restructured a debt that {faction} still doesn't know was never real",
    "signed a record they later learned was a forgery, and said nothing",
    "knows which 'conflict' was manufactured, and by whom",
    "owes {faction} a debt that was engineered, not earned",
    "kept a name off the ledger that should have been erased entirely",
    "knows exactly who profits when the debt comes due",
    "was offered forgiveness once, and it cost more than the debt did",
    "knows the true owner behind {faction}'s paper trail",
  ],
};

// Varied closers so procedural NPCs don't all end on the identical fixed
// line. "Not famous. Not nobody. Real." is a strong line exactly once —
// stamped on every runtime NPC forever it became the single most legible
// tell that a given NPC was filler rather than authored content.
const CLOSERS = [
  "Not famous. Not nobody. Real.",
  "No one sings about them. That doesn't make it not true.",
  "They didn't ask to matter. They just kept showing up.",
  "History won't remember the name. The street will.",
  "Ordinary, until you needed them not to be.",
  "One life, unremarkable and entirely their own.",
];

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
  const genreTag = genreTagFor(world?.worldId);
  const hintPool = WORLD_FLAVOR_HINTS[world?.worldId] ?? DEFAULT_WORLD_HINT_POOL;
  const worldHint = hintPool[Math.floor(rng() * hintPool.length)];
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

  // Genre-flavored quirk sentence — draws from the world's genre-tagged pool
  // (falls back to "standard" for an unrecognized/missing world) so a
  // cyberpunk NPC never draws hub-theology quirks and vice versa.
  const traitPool = TRAIT_POOLS[genreTag] || TRAIT_POOLS.standard;
  const quirk = traitPool[Math.floor(rng() * traitPool.length)];
  const quirkSentence = `Known to ${quirk}.`;

  // Genre-flavored rumored-secret sentence — same genre-tagged mechanism.
  const secretPool = SECRET_POOLS[genreTag] || SECRET_POOLS.standard;
  const secretTemplate = secretPool[Math.floor(rng() * secretPool.length)];
  const secretLine = secretTemplate
    .replace("{faction}", factionName)
    .replace("{world}", world?.worldId ?? "this place");
  const secretSentence = `Word is they ${secretLine}.`;

  // Two-trait sentence from npc.asymmetry if present.
  let traitSentence = "";
  if (npc?.preoccupation || npc?.desire) {
    const traits = [];
    if (npc.preoccupation) traits.push(`preoccupied with ${npc.preoccupation}`);
    if (npc.desire) traits.push(`quietly wants ${npc.desire}`);
    if (traits.length) traitSentence = `Lately ${traits.join(", and ")}.`;
  }

  const closer = CLOSERS[Math.floor(rng() * CLOSERS.length)];

  // Final composed prose.
  const parts = [
    `${opener} ${factionName}, ${worldHint}.`,
    bloodlineSentence,
    quirkSentence,
    secretSentence,
    traitSentence,
    closer,
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
