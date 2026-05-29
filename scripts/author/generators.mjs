// scripts/author/generators.mjs
//
// Deterministic, bible-grounded content generators for the offline pipeline.
// No LLM required (works in CI / offline); an optional LLM enhancement layer can
// post-process the prose, but the deterministic core always produces valid,
// grounded records. This is also the Watch Dogs "ctOS" engine — every generated
// NPC gets a unique procedural life (name, occupation, wealth, bio, secret,
// relationships, quirk), grounded in the world's existing factions + lore.

import { seededRng, pick } from "./lib.mjs";

const GIVEN = ["Ada","Bram","Cael","Dara","Eli","Fen","Gale","Hana","Iko","Jorah","Kesh","Lira","Mara","Nuri","Oren","Pell","Quill","Rhea","Sol","Tov","Una","Vex","Wrenn","Xan","Yara","Zeph","Brael","Sira","Tamsin","Odo","Vesna","Cyl","Marn","Dell","Swain"];
const SURNAME = ["Ashford","Brecker","Calder","Dunmore","Eaves","Frost","Garran","Holt","Irons","Jessup","Kade","Locke","Marsh","Nyx","Oller","Pyke","Quist","Reyes","Sable","Thorne","Underwood","Vance","Wills","Yarrow","Zane","Okonkwo","Sato","Reza","Bauer","Volkov"];
const QUIRKS = ["never makes eye contact","laughs at the wrong moments","collects broken things","speaks in proverbs","always cold","quotes lore nobody remembers","counts under their breath","trusts animals more than people","keeps a tally of small debts","hums an old refusal hymn"];
const WEALTH = ["destitute","scraping by","comfortable","well-off","hoarding a fortune"];
const SECRETS = [
  "owes a debt to {faction} they can't repay",
  "secretly reveres the Sovereign's First Refusal",
  "is hiding from someone in {world}",
  "knows where a sealed record is buried",
  "betrayed {faction} once and was never caught",
  "is not who they claim to be",
  "carries a relic they don't understand",
];

// Occupation pools by a coarse world flavor (falls back to 'standard').
const OCCUPATIONS = {
  standard: ["archivist","trader","guard","healer","scholar","hunter","cook","smith","courier","tinker","farmer","scribe"],
  cyber: ["netrunner","fixer","ripperdoc","data-broker","drone-tech","synth-dealer","corpo clerk","street medic"],
  crime: ["bagman","fence","lookout","enforcer","numbers-runner","getaway driver","forger","informant"],
  fantasy: ["hedge-mage","alchemist","sellsword","loremaster","beast-tamer","rune-carver","pilgrim","herbalist"],
  superhero: ["beat cop","investigator","lab tech","vigilante","reporter","paramedic","power-broker","analyst"],
  tunya: ["dune-guide","water-finder","caravan-master","sky-watcher","weaver","saltmonger","storysinger"],
};
const ARCHETYPES = ["villager","trader","scholar","guard","healer","hunter","mystic","artisan"];

// Six daily phases (≥5 distinct required by the NPC depth-floor contract). Each
// block carries { phase, phase_hours, location, activity } — the shape the routine
// engine + the npc-depth-floor contract expect.
const SCHEDULE_PHASES = [
  { phase: "dawn", phase_hours: [5, 8] },
  { phase: "morning", phase_hours: [8, 11] },
  { phase: "midday", phase_hours: [11, 14] },
  { phase: "afternoon", phase_hours: [14, 18] },
  { phase: "evening", phase_hours: [18, 22] },
  { phase: "night", phase_hours: [22, 5] },
];
const SCHEDULE_LOCATIONS = ["home", "market", "workshop", "commons", "outskirts", "tavern", "shrine", "gate"];
// Archetype → activity pool keyed loosely; falls back to a generic round.
const SCHEDULE_ACTIVITIES = {
  trader: ["opening the stall", "haggling", "restocking", "counting takings", "sharing gossip", "resting"],
  scholar: ["reading", "annotating records", "debating", "tutoring", "observing the sky", "sleeping"],
  guard: ["patrolling", "drilling", "watching the gate", "checking papers", "off-duty rounds", "resting"],
  healer: ["gathering herbs", "tending the sick", "mixing remedies", "house calls", "writing notes", "resting"],
  hunter: ["tracking", "setting snares", "field-dressing game", "trading pelts", "sharpening tools", "sleeping"],
  mystic: ["meditating", "reading omens", "communing", "warding the threshold", "chanting", "dreaming"],
  artisan: ["at the forge", "shaping work", "finishing pieces", "selling wares", "cleaning tools", "resting"],
  villager: ["chores", "working the field", "midday meal", "errands", "with family", "sleeping"],
};

/** Build a 6-block daily schedule (≥5 distinct phases) deterministically. */
function buildDailySchedule(rng, archetype) {
  const acts = SCHEDULE_ACTIVITIES[archetype] || SCHEDULE_ACTIVITIES.villager;
  return SCHEDULE_PHASES.map((p, i) => ({
    phase: p.phase,
    phase_hours: p.phase_hours,
    location: pick(rng, SCHEDULE_LOCATIONS),
    activity: acts[i % acts.length],
  }));
}

function flavorFor(world) {
  const w = String(world).toLowerCase();
  for (const k of Object.keys(OCCUPATIONS)) if (k !== "standard" && w.includes(k)) return k;
  return "standard";
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Generate `count` unique, valid NPC records grounded in the bible.
 * Deterministic by (world, startIndex). Skips names/ids already present.
 * @returns {object[]} NPC objects that pass validateNpc.
 */
export function generateNpcs(bible, count, { startIndex = 0, levelRange = [2, 30] } = {}) {
  const flavor = flavorFor(bible.world);
  const occ = OCCUPATIONS[flavor];
  const factionIds = (bible.factions || []).map((f) => f.id).filter(Boolean);
  const factionNames = (bible.factions || []).map((f) => f.name).filter(Boolean);
  const loreTitles = (bible.lore || []).map((l) => l.title).filter(Boolean);
  const out = [];
  for (let i = 0; i < count; i++) {
    // `index` is a STABLE per-world sequence (0..count-1), NOT offset by the
    // live count — so re-running with the same count yields the same ids and the
    // gate dedupes them (idempotent). `startIndex` lets a later run extend the
    // sequence to add MORE without disturbing earlier entries.
    const index = startIndex + i;
    const rng = seededRng(`${bible.world}|npc|${index}`);
    // Stable id from (world, index) — the dedupe key. Independent of name.
    const id = `gen_${bible.world}_${String(index).padStart(4, "0")}`;
    // Display name (deterministic from index); a numeric suffix disambiguates the
    // rare same-name draw without affecting the stable id.
    const name = `${pick(rng, GIVEN)} ${pick(rng, SURNAME)}${index >= GIVEN.length * SURNAME.length ? ` ${index}` : ""}`;
    const occupation = pick(rng, occ);
    const archetype = pick(rng, ARCHETYPES);
    const factionId = factionIds.length ? pick(rng, factionIds) : null;
    const factionName = factionNames.length ? pick(rng, factionNames) : "no faction";
    const wealth = pick(rng, WEALTH);
    const quirk = pick(rng, QUIRKS);
    const level = levelRange[0] + Math.floor(rng() * (levelRange[1] - levelRange[0] + 1));
    const secret = pick(rng, SECRETS).replace("{faction}", factionName).replace("{world}", bible.world);
    const loreRef = loreTitles.length ? pick(rng, loreTitles) : null;
    const backstory = `A ${wealth} ${occupation} of ${bible.world}.${factionName !== "no faction" ? ` Tied to ${factionName}.` : ""}` +
      `${loreRef ? ` Lived through "${loreRef}".` : ""} Known to ${quirk}.`;
    // Schedule + sparks use a dedicated rng seeded purely on (world, index) so the
    // values are stable regardless of changes to the bible (e.g. added factions
    // shifting earlier pick() draws) — keeps regeneration diffs minimal.
    const schedRng = seededRng(`${bible.world}|npc-sched|${index}`);
    const daily_schedule = buildDailySchedule(schedRng, archetype);
    const starting_sparks = 5 + level;
    out.push({
      id, name, archetype,
      faction_id: factionId,
      level,
      job: occupation,
      wealth_tier: wealth,
      backstory,
      personality_traits: [quirk],
      daily_schedule,
      starting_sparks,
      // ctOS profile block — the scannable "life" surfaced by the System.
      narrative_context: {
        occupation,
        wealth_tier: wealth,
        secret,
        quirk,
        bio: `${cap(occupation)} · ${wealth} · ${factionName}`,
        origin: "authoring-pipeline",
      },
      is_conscious: false,
      generated: true,
    });
  }
  return out;
}

// ── Faction generator ────────────────────────────────────────────────────────
// Deterministic, bible-grounded factions for the density-fill pipeline. Mirrors
// the rich hand-authored faction shape (motto/goal/values/fears/visual) so the
// generated rows read like the authored ones and pass validateFaction.

const FACTION_NAME = {
  standard: {
    a: ["Order", "Covenant", "Circle", "Concord", "Assembly", "Charter", "Accord", "League"],
    b: ["Wardens", "Keepers", "Stewards", "Seekers", "Hands", "Voices", "Witnesses", "Heirs"],
  },
  cyber: {
    a: ["Syndicate", "Collective", "Subnet", "Daemon", "Null", "Grid", "Cipher", "Proxy"],
    b: ["Runners", "Brokers", "Ghosts", "Forks", "Nodes", "Wraiths", "Operators", "Cells"],
  },
  crime: {
    a: ["Tarnish", "Hollow", "Ledger", "Quiet", "Crooked", "Ashen", "Velvet", "Iron"],
    b: ["Crew", "Family", "Ring", "Outfit", "Mob", "Combine", "Racket", "Firm"],
  },
  fantasy: {
    a: ["Verdant", "Ember", "Sable", "Gilded", "Hollow", "Thornwood", "Mistward", "Runebound"],
    b: ["Conclave", "Wardens", "Pilgrims", "Coven", "Circle", "Bannermen", "Chanters", "Adepts"],
  },
  superhero: {
    a: ["Sentinel", "Vanguard", "Aegis", "Civic", "Halo", "Beacon", "Bulwark", "Meridian"],
    b: ["Initiative", "Coalition", "Bureau", "Watch", "Network", "League", "Response", "Taskforce"],
  },
  tunya: {
    a: ["Salt", "Dune", "Mirage", "Wellspring", "Sky-", "Caravan", "Sand", "Oasis"],
    b: ["Wardens", "Finders", "Drovers", "Singers", "Keepers", "Pact", "Guild", "Watch"],
  },
};
const FACTION_MOTTO = [
  "What is held is held in trust.", "We do not flinch.", "The ledger always balances.",
  "Order before mercy.", "Memory outlasts stone.", "Refuse, and remain.",
  "Hold the line, hold the truth.", "Nothing kept that is not earned.",
  "We answer the silence.", "The map is not the land.", "Bend, but never break.",
  "We keep what others discard.",
];
const FACTION_GOAL = {
  standard: ["consolidate the splintered districts under one accord", "preserve the old charters against erasure", "broker peace between the rival houses on their own terms"],
  cyber: ["fork the city's governance into something they alone can audit", "free the subnets from corporate metering", "trade in the secrets the grid was built to bury"],
  crime: ["own the routes nobody else dares run", "launder the district's grief into leverage", "settle an old debt the city pretends it forgot"],
  fantasy: ["reawaken a power the loremasters sealed for good reason", "tend the wild places the settlements keep clearing", "carry a pilgrimage the realm has forbidden"],
  superhero: ["hold the line on a threat the public can't yet name", "rebuild trust between the powered and the policed", "expose the broker quietly arming both sides"],
  tunya: ["chart the water nobody believes still flows", "keep the caravan roads open through the long drought", "sing the old routes back into living memory"],
};
const FACTION_VALUES = ["loyalty", "secrecy", "endurance", "cunning", "mercy", "discipline", "memory", "autonomy", "sacrifice", "craft", "vigilance", "restraint"];
const FACTION_FEARS = ["a betrayal from within their own ranks", "the day their founding lie is spoken aloud", "a rival learning where the cache is hidden", "the loss of the one record that proves their claim", "a single strike at the heart of their power", "being remembered as the villains of the tale"];
const DIALOGUE_STYLES = ["formal_measured", "terse_guarded", "warm_persuasive", "cold_clinical", "zealous_fervent", "wry_evasive"];
const REP_CURRENCY = { standard: "standing", cyber: "compute_credits", crime: "markers", fantasy: "favor", superhero: "trust_rating", tunya: "water_tokens" };

function hexFromRng(rng) {
  const n = Math.floor(rng() * 0x1000000);
  return "#" + n.toString(16).padStart(6, "0");
}

/**
 * Generate `count` unique, valid faction records grounded in the bible.
 * Deterministic by (world, startIndex). ids are stable: gen_<world>_faction_NNNN.
 * @returns {object[]} faction objects that pass validateFaction.
 */
export function generateFactions(bible, count, { startIndex = 0 } = {}) {
  const flavor = flavorFor(bible.world);
  const names = FACTION_NAME[flavor] || FACTION_NAME.standard;
  const goals = FACTION_GOAL[flavor] || FACTION_GOAL.standard;
  const existingFactionIds = (bible.factions || []).map((f) => f.id).filter(Boolean);
  const existingNpcIds = (bible.npcs || []).map((n) => n.id).filter(Boolean);
  const out = [];
  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const rng = seededRng(`${bible.world}|faction|${index}`);
    const id = `gen_${bible.world}_faction_${String(index).padStart(4, "0")}`;
    const suffix = index >= names.a.length * names.b.length ? ` ${index}` : "";
    const name = `${pick(rng, names.a)} ${pick(rng, names.b)}${suffix}`.replace(/-\s/, "-");
    const values = [...new Set([pick(rng, FACTION_VALUES), pick(rng, FACTION_VALUES), pick(rng, FACTION_VALUES)])];
    const fears = [...new Set([pick(rng, FACTION_FEARS), pick(rng, FACTION_FEARS)])];
    // Ground rivalries/alliances in the world's existing factions when present.
    const rival = existingFactionIds.length ? pick(rng, existingFactionIds) : null;
    const ally = existingFactionIds.length > 1 ? pick(rng, existingFactionIds.filter((f) => f !== rival)) : null;
    const npcIds = existingNpcIds.length ? [pick(rng, existingNpcIds)] : [];
    out.push({
      id,
      name,
      motto: pick(rng, FACTION_MOTTO),
      goal: pick(rng, goals),
      values,
      fears,
      controlled_districts: [],
      rival_factions: rival ? [rival] : [],
      allied_factions: ally ? [ally] : [],
      npc_ids: npcIds,
      dialogue_style: pick(rng, DIALOGUE_STYLES),
      reputation_currency: REP_CURRENCY[flavor] || "standing",
      world_id: bible.world,
      visual: {
        primary_color: hexFromRng(rng),
        secondary_color: hexFromRng(rng),
        accent_color: hexFromRng(rng),
      },
      generated: true,
    });
  }
  return out;
}

// ── Crop generator ───────────────────────────────────────────────────────────
// Deterministic crops for content/crops.json (read by lib/farming.js). Shape:
// { id, name, seasons:[int 0..5], growth_days:int, yield:int }. 6 seasons exist
// (seasons.js Phase 5c), so seasons[] entries are in 0..5.

const CROP_POOL = [
  ["barley", "Barley"], ["maize", "Maize"], ["squash", "Squash"], ["pepper", "Hot Pepper"],
  ["bean", "Field Bean"], ["flax", "Flax"], ["onion", "Onion"], ["melon", "Sun Melon"],
  ["tuber", "Frost Tuber"], ["berry", "Bramble Berry"], ["rice", "Paddy Rice"], ["pumpkin", "Pumpkin"],
  ["cabbage", "Cabbage"], ["garlic", "Garlic"], ["sunflower", "Sunflower"], ["lentil", "Lentil"],
  ["chili", "Ghost Chili"], ["yam", "Yam"], ["leek", "Leek"], ["cotton", "Cotton"],
];

/**
 * Generate the first `count` crop defs from the pool (a STABLE slice from
 * `startIndex`), so re-running with the same count yields the same ids and the
 * gate dedupes them (idempotent — same contract as the NPC/faction generators).
 * @returns {object[]} crop objects that pass validateCrop.
 */
export function generateCrops(_existing, count, { startIndex = 0 } = {}) {
  const out = [];
  for (let i = 0; i < count && startIndex + i < CROP_POOL.length; i++) {
    const [id, name] = CROP_POOL[startIndex + i];
    const rng = seededRng(`crop|${id}`);
    // 1–2 seasons of affinity in 0..5, plus a 4–10 day grow + 3–8 yield.
    const s1 = Math.floor(rng() * 6);
    const seasons = rng() < 0.5 ? [s1] : [...new Set([s1, Math.floor(rng() * 6)])];
    out.push({
      id,
      name,
      seasons: seasons.sort((a, b) => a - b),
      growth_days: 4 + Math.floor(rng() * 7),
      yield: 3 + Math.floor(rng() * 6),
    });
  }
  return out;
}
