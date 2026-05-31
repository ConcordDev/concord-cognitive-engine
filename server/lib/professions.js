// server/lib/professions.js
//
// WAVE JOBS — the profession taxonomy. One parameterized schema (the
// creature-taxonomy pattern): CATEGORY → TRACK (10-tier ladder) → BRANCH @ tier
// 5 → each tier BINDS to one EXISTING playable activity (the lens IS the
// profession). This is the closed set careers/promotion/contracts read; pure
// data + resolvers, no DB. Behind CONCORD_LIVING_CAREER at the callers.
//
// The Sims-lie fix: "go to work" = "go DO the work" because Concordia already
// contains the games — chef=cook-engine, musician=DAW, athlete=sports,
// boxer=brawl, hacker=hacking, programmer=code-puzzle, farmer=farming,
// crafter=forge, detective=deduction, trader=marketplace, mage=glyph-spells.

export const CATEGORIES = Object.freeze([
  "Culinary", "Medical", "Industrial", "Security", "Creative", "Civic", "Mercantile", "Mystic", "Athletic",
]);

const ladder = (...titles) => titles; // 10 rank titles, tier 1..10

// Each track: { category, activity (the playable engine key), branchAt5:[a,b],
// ranks:[10 titles] }. wage + skillGate are derived (tier-scaled) so the schema
// stays a thin table.
export const TRACKS = Object.freeze({
  chef:       { category: "Culinary",   activity: "cook",        branchAt5: ["chef", "mixologist"], ranks: ladder("Dishwasher", "Prep Cook", "Line Cook", "Cook", "Sous Chef", "Chef", "Head Chef", "Executive Chef", "Master Chef", "Culinary Legend") },
  medic:      { category: "Medical",    activity: "diagnose",    branchAt5: ["physician", "surgeon"], ranks: ladder("Orderly", "Aide", "Nurse", "Practitioner", "Resident", "Physician", "Specialist", "Chief", "Director", "Luminary") },
  smith:      { category: "Industrial", activity: "forge",       branchAt5: ["smith", "engineer"], ranks: ladder("Hauler", "Apprentice", "Journeyman", "Smith", "Master Smith", "Forgemaster", "Artificer", "Foreman", "Guildmaster", "Grand Artificer") },
  guard:      { category: "Security",   activity: "combat",      branchAt5: ["guard", "mercenary"], ranks: ladder("Recruit", "Watch", "Guard", "Sergeant", "Lieutenant", "Captain", "Commander", "Warden", "Marshal", "Warlord") },
  musician:   { category: "Creative",   activity: "music",       branchAt5: ["performer", "producer"], ranks: ladder("Busker", "Session Player", "Bandmate", "Soloist", "Headliner", "Star", "Virtuoso", "Maestro", "Icon", "Immortal") },
  detective:  { category: "Civic",      activity: "deduction",   branchAt5: ["detective", "magistrate"], ranks: ladder("Informant", "Constable", "Investigator", "Detective", "Inspector", "Chief Inspector", "Spymaster", "Magistrate", "High Justice", "Oracle of Law") },
  trader:     { category: "Mercantile", activity: "marketplace", branchAt5: ["merchant", "broker"], ranks: ladder("Hawker", "Vendor", "Trader", "Merchant", "Magnate", "Broker", "Financier", "Tycoon", "Baron", "Mogul") },
  mage:       { category: "Mystic",     activity: "glyph",       branchAt5: ["mage", "enchanter"], ranks: ladder("Initiate", "Apprentice", "Adept", "Mage", "Archmage", "Enchanter", "Sorcerer", "Warlock", "Magister", "Ascendant") },
  athlete:    { category: "Athletic",   activity: "sport",       branchAt5: ["athlete", "coach"], ranks: ladder("Amateur", "Rookie", "Pro", "Starter", "All-Star", "Veteran", "Captain", "MVP", "Champion", "Legend") },
  fighter:    { category: "Athletic",   activity: "brawl",       branchAt5: ["brawler", "trainer"], ranks: ladder("Sparring Partner", "Prospect", "Contender", "Ranked", "Title Challenger", "Champion", "Defender", "Grand Champion", "Hall-of-Famer", "Living Legend") },
  hacker:     { category: "Industrial", activity: "hacking",     branchAt5: ["hacker", "netrunner"], ranks: ladder("Script Kiddie", "Breacher", "Intruder", "Hacker", "Cracker", "Netrunner", "Ghost", "Architect", "Daemon", "Singularity") },
  farmer:     { category: "Industrial", activity: "farming",     branchAt5: ["farmer", "rancher"], ranks: ladder("Field Hand", "Sharecropper", "Grower", "Farmer", "Homesteader", "Estate Holder", "Agronomist", "Landlord", "Patriarch", "Harvest Lord") },
});

export const MAX_TIER = 10;
export const BRANCH_TIER = 5;

const clampTier = (t) => Math.max(1, Math.min(MAX_TIER, Math.floor(Number(t) || 1)));

/** The playable activity a track binds to (constant across tiers — the lens). */
export function activityFor(trackId) {
  return TRACKS[trackId]?.activity ?? null;
}

/** Tier info: title + skill gate + wage base (tier-scaled, the thin derivation). */
export function tierInfo(trackId, tier) {
  const tr = TRACKS[trackId];
  if (!tr) return null;
  const t = clampTier(tier);
  return {
    tier: t,
    title: tr.ranks[t - 1] ?? `Tier ${t}`,
    skillGate: t * 10,              // skill level required to be promotion-eligible
    wageBase: 8 + (t - 1) * 6,      // sparks/shift at this tier (8 → 62)
    isBranchPoint: t === BRANCH_TIER,
    isMastery: t === MAX_TIER || t === BRANCH_TIER, // permanent-multiplier tiers
  };
}

/** All tracks in a category. */
export function tracksInCategory(category) {
  return Object.keys(TRACKS).filter((id) => TRACKS[id].category === category);
}

/** The branch options unlocked at tier 5 (specialisations). */
export function branchOptions(trackId) {
  return TRACKS[trackId]?.branchAt5 ?? [];
}

/** Resolve a branch choice at tier 5; null if invalid. */
export function resolveBranch(trackId, choice) {
  const opts = branchOptions(trackId);
  return opts.includes(choice) ? choice : null;
}

/** The full ladder for a track (for a career UI). */
export function ladderFor(trackId) {
  const tr = TRACKS[trackId];
  if (!tr) return [];
  return tr.ranks.map((_, i) => tierInfo(trackId, i + 1));
}

export function isTrack(trackId) { return Object.prototype.hasOwnProperty.call(TRACKS, trackId); }
