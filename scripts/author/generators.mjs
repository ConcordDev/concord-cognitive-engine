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
    out.push({
      id, name, archetype,
      faction_id: factionId,
      level,
      job: occupation,
      wealth_tier: wealth,
      backstory,
      personality_traits: [quirk],
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
