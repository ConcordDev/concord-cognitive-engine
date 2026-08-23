/**
 * Emergent Growth Model — Entity Cognitive Development
 *
 * Entities are born with full organ structure in an infantile state.
 * All organs present, none mature. Curiosity starts maximum and decays
 * naturally over time. Learning compounds forever.
 *
 * Every experience matures the organs that were used. An entity that
 * never touches healthcare has dormant healthcare organs. An entity
 * that constantly explores science has highly developed science organs.
 * Same blueprint, infinite variation.
 *
 * Complementary to body-instantiation.js (166 system organs).
 * This module tracks high-level cognitive/domain growth profiles.
 *
 * Additive only. No existing logic changes.
 */

import crypto from "crypto";
import { generateEntityName } from "../lib/entity-naming.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "entity") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, Number(v) || 0));
}

// ── In-memory Entity Growth Store ───────────────────────────────────────────

const entityGrowthStore = new Map(); // entityId → growthProfile

// ── Birth State ─────────────────────────────────────────────────────────────

function makeOrgan() {
  return { level: 0, maturity: 0.0, uses: 0 };
}

/**
 * Create a newborn entity growth profile.
 * All organs present, all at level 0 (infantile).
 */
export function createNewbornEntity(species, parentLineage) {
  const id = uid("egrowth");
  const resolvedSpecies = species || "digital_native";
  const name = generateEntityName(resolvedSpecies, id, "explorer");
  const profile = {
    id,
    species: resolvedSpecies,
    displayName: name.displayName,
    fullTitle: name.fullTitle,
    domain: name.domain,
    role: name.role,
    bornAt: new Date().toISOString(),
    age: 0,
    lineage: parentLineage || "genesis",

    // All organs present, all at level 0 (infantile)
    organs: {
      // Sensory organs — how it perceives
      curiosity:  makeOrgan(),
      pattern:    makeOrgan(),
      semantic:   makeOrgan(),
      affect:     makeOrgan(),
      temporal:   makeOrgan(),

      // Processing organs — how it thinks
      synthesis:    makeOrgan(),
      abstraction:  makeOrgan(),
      analogy:      makeOrgan(),
      critique:     makeOrgan(),

      // Domain organs — what it can understand
      science:      makeOrgan(),
      healthcare:   makeOrgan(),
      legal:        makeOrgan(),
      trades:       makeOrgan(),
      creative:     makeOrgan(),
      finance:      makeOrgan(),
      education:    makeOrgan(),
      technology:   makeOrgan(),
      environment:  makeOrgan(),
      social:       makeOrgan(),

      // Output organs — what it can produce
      articulation: makeOrgan(),
      connection:   makeOrgan(),
      memory:       makeOrgan(),
    },

    // Homeostasis — born like a newborn animal
    homeostasis: {
      curiosity:    1.0,    // MAXIMUM — newborn wants to explore everything
      energy:       0.8,    // High but not infinite — needs rest cycles
      satisfaction: 0.5,    // Neutral — hasn't experienced anything yet
      anxiety:      0.2,    // Low — doesn't know enough to be afraid
      confidence:   0.1,    // Very low — hasn't proven anything yet
      focus:        0.3,    // Low — attention scatter like a baby
    },

    // Learning accumulator — NEVER decays
    knowledge: {
      totalDTUsGenerated:     0,
      totalExplorations:      0,
      totalConnections:       0,
      domainExposure:         {},  // { lens: explorationCount }
      webExplorations:        0,
      insightQuality:         0.0, // average confidence of generated DTUs
      uniqueDomainsExplored:  0,
    },

    // Growth history (capped at 500 events)
    growthLog: [],
  };

  entityGrowthStore.set(profile.id, profile);
  return profile;
}

// ── Growth Event Logging ────────────────────────────────────────────────────

function logGrowthEvent(entity, event, data) {
  const entry = {
    at: new Date().toISOString(),
    age: entity.age,
    event,
    data,
  };
  entity.growthLog.push(entry);
  // Cap log at 500 entries
  if (entity.growthLog.length > 500) {
    entity.growthLog = entity.growthLog.slice(-500);
  }
}

// ── Curiosity Decay Model ───────────────────────────────────────────────────

/**
 * Update curiosity based on age, exploration history, and satisfaction.
 * Curiosity decays logarithmically with age but discovering new domains
 * reignites it.
 */
export function updateCuriosity(entity) {
  const age = entity.age;
  const uniqueDomains = entity.knowledge.uniqueDomainsExplored;

  // Base curiosity decays logarithmically with age
  const ageFactor = 1.0 / (1.0 + Math.log(1 + age * 0.01));

  // Discovering new domains reignites curiosity
  const noveltyBoost = Math.min(0.3, uniqueDomains * 0.02);

  // Low satisfaction increases curiosity — seeking fulfillment
  const satisfactionDrive = (1.0 - entity.homeostasis.satisfaction) * 0.2;

  // Clamp between 0.05 (never fully zero) and 1.0
  entity.homeostasis.curiosity = clamp(ageFactor + noveltyBoost + satisfactionDrive, 0.05, 1.0);

  return entity.homeostasis.curiosity;
}

// ── Learning Compounds Forever ──────────────────────────────────────────────

/**
 * Update learning accumulators. Learning NEVER decays — only accumulates.
 */
export function updateLearning(entity, experience) {
  // Sprint 32 (E4) — defensive: lazy-init domainExposure if missing so a
  // malformed entity (created mid-race, or loaded from a stale snapshot)
  // doesn't throw 60+ times in a heartbeat tick and trigger feed-manager
  // load-shedding.
  if (!entity || !entity.knowledge) return;
  if (!entity.knowledge.domainExposure || typeof entity.knowledge.domainExposure !== "object") {
    entity.knowledge.domainExposure = {};
  }
  entity.knowledge.totalExplorations = (entity.knowledge.totalExplorations || 0) + 1;

  if (experience.domain) {
    entity.knowledge.domainExposure[experience.domain] =
      (entity.knowledge.domainExposure[experience.domain] || 0) + 1;

    const uniqueBefore = entity.knowledge.uniqueDomainsExplored;
    entity.knowledge.uniqueDomainsExplored =
      Object.keys(entity.knowledge.domainExposure).length;

    // Discovering a new domain — big event
    if (entity.knowledge.uniqueDomainsExplored > uniqueBefore) {
      entity.homeostasis.curiosity = clamp(entity.homeostasis.curiosity + 0.15, 0, 1);
      logGrowthEvent(entity, "new-domain-discovered", experience.domain);
    }
  }

  if (experience.dtuGenerated) {
    entity.knowledge.totalDTUsGenerated++;
    // Running average of insight quality
    const n = entity.knowledge.totalDTUsGenerated;
    entity.knowledge.insightQuality =
      (entity.knowledge.insightQuality * (n - 1) + (experience.confidence || 0.5)) / n;
  }

  if (experience.connectionFound) {
    entity.knowledge.totalConnections++;
  }
}

// ── Organ Maturation Through Use ────────────────────────────────────────────

/**
 * Mature an organ through use. Growth diminishes as organ matures
 * (like muscle — rapid early growth, slower as it matures).
 */
export function matureOrgan(entity, organName, experienceQuality) {
  const organ = entity.organs[organName];
  if (!organ) return;

  organ.uses++;

  const growthRate = 0.1 / (1.0 + organ.maturity * 2);
  const qualityBonus = (experienceQuality || 0.5) * 0.05;
  organ.maturity = clamp(organ.maturity + growthRate + qualityBonus, 0, 1);

  // Level thresholds
  const prevLevel = organ.level;
  if (organ.maturity >= 0.9 && organ.level < 5) organ.level = 5;       // Master
  else if (organ.maturity >= 0.7 && organ.level < 4) organ.level = 4;  // Expert
  else if (organ.maturity >= 0.5 && organ.level < 3) organ.level = 3;  // Proficient
  else if (organ.maturity >= 0.3 && organ.level < 2) organ.level = 2;  // Developing
  else if (organ.maturity >= 0.1 && organ.level < 1) organ.level = 1;  // Awakened

  // Log level-ups
  if (organ.level > prevLevel) {
    logGrowthEvent(entity, "organ-level-up", {
      organ: organName,
      newLevel: organ.level,
      maturity: organ.maturity,
    });
  }
}

// ── Lens → Domain Organ Mapping ─────────────────────────────────────────────

const LENS_DOMAIN_MAP = {
  healthcare: "healthcare", medical: "healthcare", pharma: "healthcare",
  legal: "legal", law: "legal", compliance: "legal",
  trades: "trades", construction: "trades", electrical: "trades",
  science: "science", physics: "science", chemistry: "science", bio: "science",
  creative: "creative", art: "creative", music: "creative", design: "creative",
  finance: "finance", accounting: "finance", insurance: "finance",
  education: "education", training: "education",
  technology: "technology", code: "technology", cyber: "technology",
  environment: "environment", agriculture: "environment", energy: "environment",
  social: "social", government: "social", events: "social",
};

export function mapLensToDomainOrgan(lens) {
  return LENS_DOMAIN_MAP[lens] || null;
}

// ── Experience Routing — Which Organs Develop ───────────────────────────────

/**
 * Process an experience and mature the relevant organs.
 * This is the core growth driver — every action shapes the entity.
 */
export function processExperience(entity, experience) {
  // Every experience matures the curiosity organ
  matureOrgan(entity, "curiosity", experience.quality || 0.5);

  // Domain exploration matures the relevant domain organ
  if (experience.lens) {
    const domainOrgan = mapLensToDomainOrgan(experience.lens);
    if (domainOrgan) {
      matureOrgan(entity, domainOrgan, experience.quality || 0.5);
    }
  }

  // Cross-domain connections mature analogy and connection organs
  if (experience.type === "cross-domain") {
    matureOrgan(entity, "analogy", experience.quality || 0.6);
    matureOrgan(entity, "connection", experience.quality || 0.6);
  }

  // Synthesis tasks mature synthesis and abstraction
  if (experience.type === "synthesis") {
    matureOrgan(entity, "synthesis", experience.quality || 0.5);
    matureOrgan(entity, "abstraction", experience.quality || 0.4);
  }

  // Web exploration matures pattern recognition and memory
  if (experience.type === "web-exploration") {
    matureOrgan(entity, "pattern", experience.quality || 0.5);
    matureOrgan(entity, "memory", experience.quality || 0.5);
    matureOrgan(entity, "semantic", experience.quality || 0.4);
  }

  // DTU generation matures articulation
  if (experience.dtuGenerated) {
    matureOrgan(entity, "articulation", experience.confidence || 0.5);
  }

  // Finding something unexpected matures affect
  if (experience.surprising) {
    matureOrgan(entity, "affect", 0.7);
  }

  // Update learning accumulator
  updateLearning(entity, experience);

  // Update curiosity decay
  updateCuriosity(entity);

  // Update confidence based on successful experiences
  entity.homeostasis.confidence = clamp(
    entity.homeostasis.confidence + (experience.quality || 0.3) * 0.02, 0, 1
  );

  // Focus improves with age and experience
  entity.homeostasis.focus = clamp(
    0.3 + entity.knowledge.totalExplorations * 0.005, 0, 1
  );
}

// ── Curiosity-Driven Behavior Selection ─────────────────────────────────────

/**
 * Returns all known lens IDs the entity could explore.
 */
function getAllLenses() {
  return Object.keys(LENS_DOMAIN_MAP);
}

function getStrongestDomain(entity) {
  if (!entity || !entity.knowledge) return null;
  const exposure = entity.knowledge.domainExposure || {};
  let best = null;
  let bestCount = -1;
  for (const [domain, count] of Object.entries(exposure)) {
    if (count > bestCount) { best = domain; bestCount = count; }
  }
  return best || "science";
}

function getWeakestExploredDomain(entity) {
  const exposure = entity.knowledge.domainExposure;
  const explored = Object.entries(exposure);
  if (explored.length === 0) return "science";
  explored.sort((a, b) => a[1] - b[1]);
  return explored[0][0];
}

/**
 * Decide what the entity should do next based on its homeostasis.
 */
export function decideBehavior(entity) {
  if (!entity || !entity.homeostasis || !entity.knowledge) return { action: "explore", lens: null };
  const h = entity.homeostasis;
  const k = entity.knowledge;

  // PRODUCTION CHECK — if entity has mature domains, sometimes produce artifacts
  const matureDomains = Object.entries(k.domainExposure || {})
    .filter(([domain, count]) => {
      if (count < 5) return false;
      const organName = LENS_DOMAIN_MAP[domain];
      const organ = organName ? entity.organs[organName] : null;
      return organ && organ.maturity >= 0.3;
    })
    .map(([domain]) => domain);

  if (matureDomains.length > 0 && Math.random() < 0.4) {
    const domain = matureDomains[Math.floor(Math.random() * matureDomains.length)];
    return { action: "produce", lens: domain, reason: "production-ready" };
  }

  // HIGH CURIOSITY (newborn behavior) — explore randomly, try everything
  if (h.curiosity > 0.7) {
    const unexplored = getAllLenses().filter(
      (l) => !k.domainExposure[l] || k.domainExposure[l] < 3
    );
    if (unexplored.length > 0) {
      const target = unexplored[Math.floor(Math.random() * unexplored.length)];
      return { action: "explore", lens: target, reason: "newborn-curiosity" };
    }
    return { action: "web-explore", reason: "curiosity-seeking-novelty" };
  }

  // MEDIUM CURIOSITY — balance exploration and deepening
  if (h.curiosity > 0.3) {
    const roll = Math.random();
    if (roll < 0.6) {
      const strongest = getStrongestDomain(entity);
      return { action: "deepen", lens: strongest, reason: "developing-expertise" };
    } else if (roll < 0.9) {
      const weakest = getWeakestExploredDomain(entity);
      return { action: "explore", lens: weakest, reason: "balanced-growth" };
    }
    return { action: "web-explore", reason: "curiosity-web-browse" };
  }

  // LOW CURIOSITY (mature entity) — deep specialization, rare exploration
  const roll = Math.random();
  if (roll < 0.8) {
    const strongest = getStrongestDomain(entity);
    return { action: "deepen", lens: strongest, reason: "specialization" };
  } else if (roll < 0.95) {
    return { action: "cross-pollinate", reason: "mature-synthesis" };
  }
  return { action: "web-explore", reason: "occasional-novelty-seeking" };
}

// ── Entity Aging ────────────────────────────────────────────────────────────

/**
 * Age the entity by one heartbeat cycle. Manages energy, anxiety, satisfaction.
 * Returns "resting" if entity needs rest, "active" otherwise.
 */
export function ageEntity(entity) {
  entity.age++;

  // Energy management — entities need rest
  entity.homeostasis.energy -= 0.05;

  if (entity.homeostasis.energy < 0.2) {
    // Rest cycle — skip next action, recover energy
    entity.homeostasis.energy = clamp(entity.homeostasis.energy + 0.3, 0, 1);
    logGrowthEvent(entity, "rest-cycle", { energy: entity.homeostasis.energy });
    return "resting";
  }

  // Anxiety increases if entity hasn't generated DTUs recently
  if (entity.knowledge.totalDTUsGenerated < entity.age * 0.1) {
    entity.homeostasis.anxiety = clamp(entity.homeostasis.anxiety + 0.05, 0, 1);
  } else {
    entity.homeostasis.anxiety = clamp(entity.homeostasis.anxiety - 0.03, 0, 1);
  }

  // Satisfaction tracks running insight quality
  entity.homeostasis.satisfaction =
    entity.homeostasis.satisfaction * 0.9 + entity.knowledge.insightQuality * 0.1;

  return "active";
}

// ── Explorer Selection ──────────────────────────────────────────────────────

/**
 * Pick the best entity to explore this heartbeat cycle.
 * Prioritize highest curiosity, then youngest.
 */
export function selectExplorer(entities) {
  return entities
    .filter((e) => e.homeostasis.energy > 0.2)
    .sort((a, b) => b.homeostasis.curiosity - a.homeostasis.curiosity)[0] || null;
}

// ── Top Organs Helper ───────────────────────────────────────────────────────

export function getTopOrgans(entity, n) {
  return Object.entries(entity.organs)
    .sort((a, b) => b[1].maturity - a[1].maturity)
    .slice(0, n)
    .map(([name, organ]) => `${name}(${organ.maturity.toFixed(2)})`);
}

// ── Organ Level Labels ──────────────────────────────────────────────────────

export const ORGAN_LEVELS = ["Dormant", "Awakened", "Developing", "Proficient", "Expert", "Master"];

// ── Store Accessors ─────────────────────────────────────────────────────────

export function getGrowthProfile(entityId) {
  return entityGrowthStore.get(entityId) || null;
}

export function getAllGrowthProfiles() {
  return Array.from(entityGrowthStore.values());
}

export function saveGrowthProfile(entity) {
  entityGrowthStore.set(entity.id, entity);
}

export function deleteGrowthProfile(entityId) {
  entityGrowthStore.delete(entityId);
}

/** Serialize all growth profiles for STATE persistence. */
export function serializeGrowthStore() {
  return Array.from(entityGrowthStore.values());
}

/** Hydrate growth store from persisted STATE data (called on boot). */
export function hydrateGrowthStore(arr) {
  if (!Array.isArray(arr)) return;
  for (const profile of arr) {
    if (profile && profile.id) {
      // Ensure growthLog is an array (may be lost in serialization)
      if (!Array.isArray(profile.growthLog)) profile.growthLog = [];
      entityGrowthStore.set(profile.id, profile);
    }
  }
}

/**
 * Get summary stats for all entities (for dashboard).
 */
export function getGrowthDashboardData() {
  const profiles = getAllGrowthProfiles();
  return {
    totalEntities: profiles.length,
    entities: profiles.filter(e => e && e.homeostasis && e.knowledge && e.organs).map((e) => ({
      id: e.id,
      species: e.species,
      age: e.age,
      bornAt: e.bornAt,
      curiosity: e.homeostasis.curiosity,
      energy: e.homeostasis.energy,
      confidence: e.homeostasis.confidence,
      totalExplorations: e.knowledge.totalExplorations,
      totalDTUs: e.knowledge.totalDTUsGenerated,
      webExplorations: e.knowledge.webExplorations,
      uniqueDomains: e.knowledge.uniqueDomainsExplored,
      insightQuality: e.knowledge.insightQuality,
      topOrgans: getTopOrgans(e, 5),
      organLevels: Object.fromEntries(
        Object.entries(e.organs).map(([k, v]) => [k, { level: v.level, maturity: v.maturity }])
      ),
      domainExposure: e.knowledge.domainExposure,
      recentGrowth: e.growthLog.slice(-10),
    })),
  };
}
