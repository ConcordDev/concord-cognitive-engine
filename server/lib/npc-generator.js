// server/lib/npc-generator.js
//
// Phase 7 — Procedural NPC Generator.
//
// Each faction has a psychological profile: a distribution over named
// personality dimensions. The generator samples the distribution, picks
// faction-flavored name + life events, and emits an NPC object that
// matches the validateNpc schema (see lib/content-seeder.js#validateNpc).
//
// Determinism: every generated NPC is keyed by sha1(world + faction +
// index + seed). Same key → same NPC, always. The personality vector
// is reproducible.
//
// Outlier mechanic: the NPC's *secret* is the dimension where they
// diverge most from their faction's profile baseline — a Warden whose
// individualism rolled high secretly chafes against orders; a Mystic
// whose skepticism rolled high quietly doubts the goddess. This is
// what makes generated NPCs feel real instead of archetype-generic.

import crypto from "node:crypto";
import {
  gradientConfigFor, hubAnchorFor, dangerBandAt, bandLevelRange, radialWorldsEnabled,
} from "./world-gradient.js";
import { seedStarterGear } from "./npc-gear.js";

// ── Personality dimensions ──────────────────────────────────────────────────

// Eight named dimensions. Each is on [0, 1] but normally sampled around a
// faction-specific mean with a faction-specific stddev. The cross-product
// produces ~256 distinct meaningful trait combinations per faction.
export const DIMENSIONS = Object.freeze([
  "discipline",            // structure-oriented vs improvisational
  "loyalty",               // toward in-group; complement of opportunism
  "patience",              // long-game vs short-game
  "introspection",         // examines own motives
  "individualism",         // chafes against group norms
  "humor",                 // dry to gallows to light to none
  "skepticism",            // questions claims (turned at evidence not people)
  "forgiveness",           // softness toward perceived wrongs
]);

// ── Faction psychology profiles ─────────────────────────────────────────────

// Each profile is a partial vector of (mean, stddev) pairs. Dimensions not
// listed default to (0.5, 0.18) — neutral with moderate variance.
//
// Read this as: "the typical Warden is highly disciplined and loyal with
// low variance; their humor and individualism roll low with low variance
// too; everything else is roughly average."
//
// The variances matter. A Warden with low-variance discipline means
// almost every Warden is disciplined; you have to roll several before
// you get a maverick. A Mystic with high-variance forgiveness means the
// faction includes both the gentlest and the harshest souls you'll meet.
export const FACTION_PROFILES = Object.freeze({
  iron_wardens: {
    archetypes: ["warrior", "guard", "warrior", "warrior", "guard", "scholar"],
    dimensions: {
      discipline:    { mean: 0.85, std: 0.10 },
      loyalty:       { mean: 0.82, std: 0.12 },
      patience:      { mean: 0.65, std: 0.15 },
      introspection: { mean: 0.40, std: 0.16 },
      individualism: { mean: 0.25, std: 0.15 },
      humor:         { mean: 0.30, std: 0.18 },
      skepticism:    { mean: 0.55, std: 0.18 },
      forgiveness:   { mean: 0.40, std: 0.20 },
    },
    name_first: ["Kael", "Iris", "Horne", "Vesta", "Brom", "Aldric", "Mira", "Roen", "Thessa", "Garrick", "Lyse", "Corwin", "Fenra", "Tassan", "Wren"],
    name_last:  ["Torchlight", "Rivenmark", "Stoneward", "Ironvale", "Northgate", "Holm", "Oakshield", "Vance", "Marsh", "Coldwater", "Harrow", "Greaves"],
    role_pool: ["South Gate watch", "North Gate watch", "Eastern checkpoint", "Western patrol", "Inner courtyard guard", "Toll inspector", "Roll clerk", "Field captain", "Garrison sergeant"],
    fear_pool: ["losing the watch", "the wrong reinforcement arriving late", "a duel-pact roll going unsigned", "becoming the kind of captain who looks the other way", "the gate falling on their watch"],
  },
  scholars_guild: {
    archetypes: ["scholar", "scholar", "healer", "mystic", "miller", "cook", "laborer"],
    dimensions: {
      discipline:    { mean: 0.70, std: 0.13 },
      loyalty:       { mean: 0.55, std: 0.18 },
      patience:      { mean: 0.78, std: 0.10 },
      introspection: { mean: 0.80, std: 0.12 },
      individualism: { mean: 0.55, std: 0.18 },
      humor:         { mean: 0.55, std: 0.20 },
      skepticism:    { mean: 0.85, std: 0.10 },
      forgiveness:   { mean: 0.60, std: 0.18 },
    },
    name_first: ["Tollan", "Yshe", "Maren", "Oswen", "Silas", "Avia", "Thero", "Cyra", "Pellan", "Brielle", "Ostavin", "Renna", "Wyllem", "Ivelle"],
    name_last:  ["Ashveil", "Grey", "Lorekeeper", "Wright", "Halvern", "Reade", "Dunmore", "Mirelle", "Quinn", "Vellis", "Hollow", "Penn"],
    role_pool: ["Junior archivist", "Restoration scholar", "Field surgeon", "Vault keeper", "Lectern reader", "Citation auditor", "Manuscript copyist", "Hospice steward"],
    fear_pool: ["the wrong vault burning next", "their citation chain failing audit", "discovering their thesis is wrong after publication", "being asked to forget a thing they remember", "the Purge happening twice"],
  },
  merchant_collective: {
    archetypes: ["trader", "trader", "trader", "guard", "miller", "cook", "builder", "laborer"],
    dimensions: {
      discipline:    { mean: 0.65, std: 0.15 },
      loyalty:       { mean: 0.55, std: 0.20 },
      patience:      { mean: 0.72, std: 0.13 },
      introspection: { mean: 0.50, std: 0.20 },
      individualism: { mean: 0.65, std: 0.18 },
      humor:         { mean: 0.65, std: 0.18 },
      skepticism:    { mean: 0.70, std: 0.13 },
      forgiveness:   { mean: 0.50, std: 0.18 },
    },
    name_first: ["Vael", "Dessa", "Toman", "Brina", "Halvor", "Cessa", "Rin", "Pello", "Mavis", "Quint", "Sylene", "Ardin", "Ferra", "Owain"],
    name_last:  ["Silvercoin", "Brewer", "Goldspoke", "Tally", "Halfhand", "Wright", "Carpenter", "Cordmaker", "Inkstain", "Salts", "Marker", "Cabletree"],
    role_pool: ["Salt-route arbiter", "Fourth-stall keeper", "Tariff auditor", "Caravan guard", "Inkmaster", "Gem broker", "Toll inspector", "Council second"],
    fear_pool: ["a deal closing wrong", "the Wardens being right about them", "leaving more money in the room than they should have", "outliving their reputation", "their rivals' children doing better than theirs"],
  },
  verdant_veil_remnant: {
    archetypes: ["mystic", "healer", "hunter", "farmer", "logger", "fisher", "cook"],
    dimensions: {
      discipline:    { mean: 0.65, std: 0.15 },
      loyalty:       { mean: 0.78, std: 0.13 },
      patience:      { mean: 0.92, std: 0.05 },
      introspection: { mean: 0.88, std: 0.08 },
      individualism: { mean: 0.30, std: 0.16 },
      humor:         { mean: 0.30, std: 0.16 },
      skepticism:    { mean: 0.45, std: 0.20 },
      forgiveness:   { mean: 0.78, std: 0.13 },
    },
    name_first: ["Lyra", "Bell", "Thorne", "Esme", "Oran", "Nyssa", "Rowan", "Vela", "Sasha", "Ferin", "Asha", "Hollin", "Mire", "Pell"],
    name_last:  ["Silentchant", "Blackroot", "Greenmantle", "Hollowbreath", "Stillwater", "Mossbearer", "Quietfoot", "Ashveil", "Linden", "Cattail"],
    role_pool: ["Keeper of the second hour", "Hospice keeper", "Forester at the eastern blind", "Pilgrim guide", "Glyph-tracer", "Inner-grove tender", "Lantern-keeper of the third path"],
    fear_pool: ["hearing a ninth refusal they cannot teach", "the upper grove going silent", "their student leaving uninitiated", "the goddess answering wrong", "remembering what the third keeper saw"],
  },
  shadow_network: {
    archetypes: ["trader", "scholar", "cyber", "trader", "guard"],
    dimensions: {
      discipline:    { mean: 0.72, std: 0.13 },
      loyalty:       { mean: 0.60, std: 0.20 },
      patience:      { mean: 0.70, std: 0.15 },
      introspection: { mean: 0.60, std: 0.18 },
      individualism: { mean: 0.78, std: 0.13 },
      humor:         { mean: 0.45, std: 0.20 },
      skepticism:    { mean: 0.80, std: 0.10 },
      forgiveness:   { mean: 0.30, std: 0.18 },
    },
    name_first: ["Ash", "Cipher", "Knot", "Ren", "Pell", "Vex", "Cinder", "Mara", "Hollow", "Six", "Wren", "Tav", "Quil"],
    name_last:  ["Cipher", "Pageturn", "Grey", "Lasthand", "Nine", "Static", "Echo", "Mirror", "Twoname", "Sallow", "Quietmark", "Inkleaf"],
    role_pool: ["Repo broker", "Pageturn courier", "Third-hand operator", "Listening-post keeper", "Counter-archive watcher", "Burner-handle clerk", "Whisper-route arbiter"],
    fear_pool: ["being remembered wrong", "the third handle being burned before the fourth is set", "a counterpart they trusted naming them", "being known by the right name", "the Wardens already knowing"],
  },
  pinewood_coalition: {
    archetypes: ["warrior", "hunter", "trader", "healer", "farmer", "logger", "miner", "builder"],
    dimensions: {
      discipline:    { mean: 0.72, std: 0.12 },
      loyalty:       { mean: 0.80, std: 0.10 },
      patience:      { mean: 0.55, std: 0.18 },
      introspection: { mean: 0.50, std: 0.18 },
      individualism: { mean: 0.50, std: 0.16 },
      humor:         { mean: 0.65, std: 0.15 },
      skepticism:    { mean: 0.55, std: 0.16 },
      forgiveness:   { mean: 0.55, std: 0.18 },
    },
    name_first: ["Tarn", "Fia", "Brennan", "Yseult", "Donal", "Mara", "Cullen", "Aoife", "Reeve", "Saoirse", "Briar", "Owen", "Niall", "Liss"],
    name_last:  ["Pinemark", "Blackwood", "Ashridge", "Ashfield", "Greenfell", "Marrow", "Ironroot", "Stonebrook", "Coldfen", "Highbridge", "Reedmere"],
    role_pool: ["Coalition envoy", "Border watch", "Salt-route guide", "Pinewood militia", "Field hospital", "Reconnaissance", "Outpost keeper", "Cousin-line arbiter"],
    fear_pool: ["the Coalition fragmenting", "the Wardens making a separate peace", "being remembered as the cousin who broke the line", "the salt-route closing for good", "having to choose between Pinewood and the gate"],
  },
  default: {
    archetypes: ["default", "farmer", "laborer", "cook", "builder", "miner", "logger", "fisher", "miller"],
    dimensions: {},
    name_first: ["Wren", "Hollin", "Ash", "Pell", "Cyra", "Oren", "Mira", "Tann", "Esme"],
    name_last:  ["Marrow", "Linden", "Vellis", "Wright", "Thorne", "Reedmere"],
    role_pool: ["townsfolk", "wanderer", "traveler", "shopkeep", "labourer"],
    fear_pool: ["being forgotten", "the world tilting wrong", "the day going the way the day was going to go anyway"],
  },
});

// ── Life event templates (faction-flavored backstory fragments) ─────────────

const LIFE_EVENTS_BY_FACTION = Object.freeze({
  iron_wardens: [
    "lost a sibling at the Pinewood crossing and walked back without saying which",
    "took the third-watch rotation when no one else would, and never asked to be moved",
    "signed a duel-pact roll for someone they hadn't met, on the strength of a captain's nod",
    "was relieved at the gate by a captain whose name they later refused to record",
    "held the eastern checkpoint through a frost season alone after their relief disappeared",
  ],
  scholars_guild: [
    "watched the Vault Seventeen fires and counted the locks on the way back to the dormitory",
    "apprenticed late, after refusing the inheritance their father wanted them to take",
    "reconstructed a destroyed text from memory and three contraband fragments, and never published it",
    "was the third reader of a paper that was never accepted by the council",
    "kept a private journal that contradicts the public archive on one specific date",
  ],
  merchant_collective: [
    "was raised in three markets across the Coalition by their twelfth year",
    "closed their first deal at fourteen with a Warden who refused to give a name",
    "lost an entire caravan in the second drought and didn't speak for the third year",
    "was offered a Shadow Network seat once and didn't refuse it as fast as they later said",
    "renegotiated a tariff at the seventh toll on a handshake that has not yet been written down",
  ],
  verdant_veil_remnant: [
    "came down from the upper grove during the second drought and never said why",
    "took the third vow under a keeper who walked into the goddess and didn't return",
    "refused a ninth refusal and has not told anyone what it was for",
    "tended the inner glyph alone for a season after their teacher fell silent",
    "carried a sealed letter to the goddess's emissary and was given a sealed letter back",
  ],
  shadow_network: [
    "burned three handles before settling on the one they wear now",
    "moved goods between two factions during a stand-down both sides denied",
    "refused payment for a job because the client lied about the destination",
    "was named by a counterparty once and walked east for a season",
    "kept a single mark in their ledger that they have never explained",
  ],
  pinewood_coalition: [
    "stood at the Pinewood crossing and walked back with two arrows in their cloak",
    "envoyed to the Wardens during a stand-down and came back with a different opinion",
    "was the third reader of a treaty that the elders never ratified",
    "held the salt route open through a Warden tariff dispute",
    "carried news of the second drought back to the upper grove personally",
  ],
  default: [
    "came in from outside the gate during a season nobody remembers clearly",
    "took the work nobody else wanted and stopped expecting thanks",
    "lost something they don't talk about and kept the receipt anyway",
  ],
});

// ── Sampling primitives (deterministic) ─────────────────────────────────────

function sha1Bytes(seed) {
  return crypto.createHash("sha1").update(seed).digest();
}

/**
 * Deterministic uniform float [0, 1) from a seed buffer + offset.
 */
function uniform(seedBuf, offset) {
  const i = offset % seedBuf.length;
  const lo = seedBuf[i];
  const hi = seedBuf[(i + 1) % seedBuf.length];
  return ((hi << 8) + lo) / 65536;
}

/**
 * Deterministic normal sample using Box-Muller from two uniforms.
 * Caller passes the seed buffer and offsets so reruns are stable.
 */
function normal(seedBuf, offsetA, offsetB, mean = 0, std = 1) {
  const u1 = Math.max(uniform(seedBuf, offsetA), 1e-9);
  const u2 = uniform(seedBuf, offsetB);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function pickFromArray(seedBuf, offset, arr) {
  if (!arr || arr.length === 0) return null;
  const i = (uniform(seedBuf, offset) * arr.length) | 0;
  return arr[Math.min(i, arr.length - 1)];
}

// ── Generator core ──────────────────────────────────────────────────────────

/**
 * Sample a personality vector for a faction. Returns
 * { discipline, loyalty, patience, ... } each in [0, 1].
 */
export function samplePersonality(seedBuf, factionProfile) {
  const dims = factionProfile?.dimensions || {};
  const out = {};
  let off = 0;
  for (const dim of DIMENSIONS) {
    const params = dims[dim] || { mean: 0.5, std: 0.18 };
    out[dim] = clamp01(normal(seedBuf, off, off + 1, params.mean, params.std));
    off += 2;
  }
  return out;
}

/**
 * Pick the dimension where the NPC most diverges from their faction's
 * baseline — this becomes their secret/outlier trait.
 */
export function findOutlierDimension(personality, factionProfile) {
  const dims = factionProfile?.dimensions || {};
  let bestDim = null;
  let bestDelta = 0;
  for (const dim of DIMENSIONS) {
    const params = dims[dim] || { mean: 0.5, std: 0.18 };
    const delta = Math.abs(personality[dim] - params.mean);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestDim = dim;
    }
  }
  return { dimension: bestDim, delta: bestDelta };
}

const SECRET_TEMPLATES_BY_DIMENSION = Object.freeze({
  discipline:    { high: "secretly improvises more than the rolls record",        low:  "has a discipline they never let the captain see"        },
  loyalty:       { high: "loyal past what their faction has earned",              low:  "would sell out their faction for the right reason"      },
  patience:      { high: "has waited for something longer than they will admit",  low:  "has rushed a decision they still pretend they didn't"   },
  introspection: { high: "reads themselves more honestly than they read others",  low:  "has not asked themselves a hard question in years"      },
  individualism: { high: "chafes against orders even when they obey",             low:  "fits the mold tighter than is healthy"                  },
  humor:         { high: "uses humor to hide a thing nobody has guessed",         low:  "has not laughed since a season they will not name"      },
  skepticism:    { high: "doubts the faction's foundational text in private",     low:  "believes a story they have been told that isn't true"   },
  forgiveness:   { high: "forgave something once that they should not have",      low:  "carries a grudge that has outgrown its original cause"  },
});

function secretFor(personality, outlier) {
  if (!outlier?.dimension) return "carries a small secret they have never spoken aloud";
  const templates = SECRET_TEMPLATES_BY_DIMENSION[outlier.dimension];
  if (!templates) return "has an inconsistency in themselves they are not yet ready to name";
  const high = personality[outlier.dimension] > 0.5;
  return high ? templates.high : templates.low;
}

function topTraits(personality, n = 4) {
  const sorted = DIMENSIONS
    .map(d => ({ d, v: personality[d] }))
    .sort((a, b) => Math.abs(b.v - 0.5) - Math.abs(a.v - 0.5));
  return sorted.slice(0, n).map(x => {
    const high = x.v > 0.5;
    return high ? x.d : `low_${x.d}`;
  });
}

function speechStyleFor(personality) {
  const formal = personality.discipline > 0.65 || personality.introspection > 0.7;
  const terse = personality.patience < 0.45 || personality.humor < 0.35;
  const dry = personality.humor < 0.4 && personality.skepticism > 0.6;
  const verbose = personality.introspection > 0.75 || personality.skepticism > 0.8;
  if (formal && verbose) return "Formal, citation-heavy, slow to answer direct questions.";
  if (formal && terse)   return "Short formal sentences. Refers to roles, not names.";
  if (dry)               return "Dry. Brief. Uses humor as defense.";
  if (verbose)           return "Discursive, often pauses to qualify their own claims.";
  if (terse)             return "Short sentences, plain words, no embellishment.";
  return "Plain-spoken with the occasional unexpected aside.";
}

/**
 * Generate one NPC for a faction. Deterministic by seed.
 *
 * Returns an object matching validateNpc shape:
 *   { id, name, archetype, faction_id, role, level, backstory,
 *     personality_traits, speech_patterns, narrative_context: {
 *       current_goal, fear, secret
 *     }, home_world, _generated: { seed, personality, outlier } }
 */
export function generateNpc({ factionId, seed, worldId = "concordia-hub", level = null }) {
  if (!factionId || !seed) return null;
  const profile = FACTION_PROFILES[factionId] || FACTION_PROFILES.default;
  const seedBuf = sha1Bytes(`${worldId}|${factionId}|${seed}`);

  const personality = samplePersonality(seedBuf, profile);
  const outlier = findOutlierDimension(personality, profile);

  const archetype = pickFromArray(seedBuf, 30, profile.archetypes) || "default";
  const firstName = pickFromArray(seedBuf, 32, profile.name_first) || "Wren";
  const lastName  = pickFromArray(seedBuf, 34, profile.name_last)  || "Marrow";
  const role      = pickFromArray(seedBuf, 36, profile.role_pool)  || "townsfolk";

  const events = LIFE_EVENTS_BY_FACTION[factionId] || LIFE_EVENTS_BY_FACTION.default;
  const lifeEvent = pickFromArray(seedBuf, 38, events) || "came from somewhere they don't speak about";

  const fearPool = profile.fear_pool || [];
  const fear = pickFromArray(seedBuf, 40, fearPool) || "becoming the kind of person they swore they wouldn't";

  const id = `pn_${crypto.createHash("sha1").update(`${worldId}|${factionId}|${seed}`).digest("hex").slice(0, 12)}`;
  const name = `${firstName} ${lastName}`;

  const traits = topTraits(personality);
  const speechStyle = speechStyleFor(personality);
  const secret = secretFor(personality, outlier);

  const lvl = level != null ? level : (5 + Math.floor(uniform(seedBuf, 42) * 35));

  const backstory = `${name} ${lifeEvent}. They serve as ${role.toLowerCase()} in the ${factionLabel(factionId)}.`;

  return {
    id, name, archetype,
    faction_id: factionId,
    role,
    level: lvl,
    home_world: worldId,
    backstory,
    personality_traits: traits,
    speech_patterns: speechStyle,
    narrative_context: {
      current_goal: `to remain useful to the ${factionLabel(factionId)} through the season`,
      fear,
      secret,
    },
    _generated: {
      seed: `${worldId}|${factionId}|${seed}`,
      personality,
      outlier,
      life_event: lifeEvent,
    },
  };
}

function factionLabel(factionId) {
  const labels = {
    iron_wardens: "Iron Wardens",
    scholars_guild: "Scholars' Guild",
    merchant_collective: "Merchant Collective",
    verdant_veil_remnant: "Verdant Veil",
    shadow_network: "Shadow Network",
    pinewood_coalition: "Pinewood Coalition",
  };
  return labels[factionId] || factionId;
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist a generated NPC to world_npcs + procedural_npcs. Idempotent
 * on the generated id. Spawn position randomized inside a 200m disc
 * around (0, 0) for now — caller can override.
 */
export function persistGeneratedNpc(db, npc, opts = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "missing_inputs" };
  const seedBuf = sha1Bytes(`${npc.id}|spawn`);
  const ax = opts.x ?? (uniform(seedBuf, 0) * 400 - 200);
  const az = opts.z ?? (uniform(seedBuf, 4) * 400 - 200);

  // WS2: when radial worlds are on, the NPC's level is band-appropriate for
  // where it actually spawns — a hostile placed near the frontier is strong,
  // a villager near the hub stays weak. Falls back to the generator's level.
  let spawnLevel = npc.level;
  if (radialWorldsEnabled()) {
    try {
      const world = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(npc.home_world);
      const cfg = gradientConfigFor(world || null);
      const anchor = hubAnchorFor(db, npc.home_world, cfg);
      const [lo, hi] = bandLevelRange(cfg, dangerBandAt(cfg, anchor, ax, az));
      const h = sha1Bytes(`${npc.id}|lvl`)[0];
      spawnLevel = hi > lo ? lo + (h % (hi - lo + 1)) : lo;
    } catch { /* keep generator level */ }
  }

  // Idempotency check.
  try {
    const existing = db.prepare(`SELECT npc_id FROM procedural_npcs WHERE npc_id = ?`).get(npc.id);
    if (existing) return { ok: true, action: "already_exists", npcId: npc.id };
  } catch { /* table optional */ }

  const tx = db.transaction(() => {
    // world_npcs row — match the columns the rest of the substrate reads.
    try {
      const stateJson = JSON.stringify({
        name: npc.name,
        archetype: npc.archetype,
        faction: npc.faction_id,
        backstory: npc.backstory,
        personality_traits: npc.personality_traits,
        speech_patterns: npc.speech_patterns,
        narrative_context: npc.narrative_context,
        procedural: true,
      });
      db.prepare(`
        INSERT INTO world_npcs
          (id, world_id, archetype, faction, level, x, z,
           current_location, spawn_location, state, is_dead)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO NOTHING
      `).run(
        npc.id, npc.home_world, npc.archetype, npc.faction_id,
        spawnLevel, ax, az,
        JSON.stringify({ x: ax, z: az }),
        JSON.stringify({ x: ax, z: az }),
        stateJson,
      );
    } catch { /* world_npcs schema may differ on minimal builds */ }

    db.prepare(`
      INSERT INTO procedural_npcs
        (npc_id, faction, world_id, generation_seed,
         personality_vector, life_events_json, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      npc.id, npc.faction_id, npc.home_world,
      npc._generated.seed,
      JSON.stringify(npc._generated.personality),
      JSON.stringify([npc._generated.life_event]),
    );

    // D4 #3 — join the existing gear economy (lib/npc-gear.js) so procedural
    // NPCs are visually distinct (gear_level + archetype loadout) AND drop loot
    // on death via the existing kill-path loot generator (which reads
    // getNPCGear). Gear level scales with the NPC's own level. Until now the
    // spawner skipped this, so the bulk of the population had 0 gear / 0 loot.
    try {
      const gearLvl = Math.max(1, Math.min(10, Math.ceil((Number(spawnLevel) || npc.level || 5) / 5)));
      seedStarterGear(db, npc.id, npc.archetype || "default", gearLvl);
    } catch { /* npc_gear table optional on minimal builds */ }
  });

  try { tx(); } catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }
  return { ok: true, action: "created", npcId: npc.id, position: { x: ax, z: az } };
}

/**
 * Spawn N procedural NPCs for a world, distributed across factions.
 *
 * factionDistribution: { iron_wardens: 5, scholars_guild: 3, ... }
 * Returns { ok, spawned, samples }.
 */
export function spawnProceduralNpcsForWorld(db, worldId, factionDistribution) {
  if (!db || !worldId || !factionDistribution) return { ok: false, reason: "missing_inputs" };
  const samples = [];
  let spawned = 0;
  for (const [factionId, count] of Object.entries(factionDistribution)) {
    const N = Math.max(0, Math.min(500, Number(count) || 0));
    for (let i = 0; i < N; i++) {
      const npc = generateNpc({ factionId, seed: `gen_${i}`, worldId });
      if (!npc) continue;
      const r = persistGeneratedNpc(db, npc);
      if (r.ok && r.action === "created") {
        spawned++;
        if (samples.length < 5) samples.push({ id: npc.id, name: npc.name, faction: factionId });
      }
    }
  }
  return { ok: true, spawned, samples };
}

/**
 * Read a procedural NPC's stored personality vector. Useful for analytics
 * and for asymmetry seeding to pull faction-grounded baselines.
 */
export function getProceduralPersonality(db, npcId) {
  if (!db || !npcId) return null;
  try {
    const row = db.prepare(`SELECT personality_vector FROM procedural_npcs WHERE npc_id = ?`).get(npcId);
    if (!row) return null;
    return JSON.parse(row.personality_vector);
  } catch { return null; }
}

export const _internal = {
  DIMENSIONS,
  FACTION_PROFILES,
  LIFE_EVENTS_BY_FACTION,
  SECRET_TEMPLATES_BY_DIMENSION,
  uniform,
  normal,
  clamp01,
  pickFromArray,
  samplePersonality,
  findOutlierDimension,
  topTraits,
  speechStyleFor,
  secretFor,
};
