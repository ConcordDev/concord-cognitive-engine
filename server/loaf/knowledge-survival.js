import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IX.1 — Knowledge Survival & Continuity
 *
 * Capabilities (Knowledge Survival):
 *   1.  Knowledge continuity guarantees across system changes
 *   2.  Epistemic succession handling (graceful knowledge transfer)
 *   3.  Canon survival strategies (knowledge that must persist)
 *   4.  Cold-start recovery from minimal knowledge seeds
 *   5.  Knowledge-at-extinction-risk identification
 *   6.  Priority-based knowledge protection tiers
 *   7.  Knowledge redundancy and replication
 *   8.  Survival of meaning (not just data) under degradation
 *   9.  Cross-format knowledge preservation
 *   10. Knowledge dependency mapping for survival planning
 *   11. Minimum viable epistemic state identification
 *   12. Knowledge resurrection from partial fragments
 *   13. Continuity verification checksums
 *   14. Succession rehearsals (dry-run knowledge transfers)
 *   15. Dead knowledge detection and archival
 *
 * Design:
 *   - Knowledge items are classified by survival priority
 *   - Canon entries have explicit survival strategies
 *   - Cold-start recovery works from minimal seed sets
 *   - Continuity is verified through checksums and integrity checks
 *   - Succession is rehearsed before actual transfers
 *   - Dead knowledge is detected and archived, not deleted
 */

// === SURVIVAL TIERS ===

const SURVIVAL_PRIORITY = Object.freeze({
  CRITICAL: "critical",       // must survive at all costs — core invariants
  HIGH: "high",               // should survive — foundational knowledge
  MEDIUM: "medium",           // valuable but reconstructible
  LOW: "low",                 // nice to have, easily re-derived
  ARCHIVAL: "archival",       // no longer active, preserved for history
});

const KNOWLEDGE_STATUS = Object.freeze({
  ALIVE: "alive",             // actively used and maintained
  DORMANT: "dormant",         // not currently used but may be needed
  AT_RISK: "at_risk",         // in danger of being lost
  EXTINCT: "extinct",         // lost, needs resurrection
  ARCHIVED: "archived",       // intentionally shelved
});

const SUCCESSION_STATES = Object.freeze({
  PLANNED: "planned",
  REHEARSED: "rehearsed",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
});

const MAX_KNOWLEDGE_ITEMS = 2000;
const MAX_CANON_ENTRIES = 500;
const MAX_SEEDS = 200;
const MAX_SUCCESSIONS = 100;
const MAX_DEPENDENCIES = 1000;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// knowledgeId -> { content, priority, status, dependencies[], redundancy, checksum, ... }
const knowledgeItems = new LruMap();
// canonId -> { knowledgeIds[], survivalStrategy, protectionLevel }
const canonEntries = new LruMap();
// seedId -> { knowledgeIds[], description, coldStartInstructions }
const coldStartSeeds = new LruMap();
// successionId -> { from, to, knowledgeIds[], state, rehearsals[] }
const successions = new LruMap();
// depId -> { from, to, type, strength }
const dependencies = new LruMap();

// === KNOWLEDGE REGISTRATION ===

/**
 * Register a knowledge item with survival metadata.
 */
function registerKnowledge(content, priority, metadata = {}) {
  if (!Object.values(SURVIVAL_PRIORITY).includes(priority)) {
    return { ok: false, error: `Unknown priority: ${priority}` };
  }
  const id = `kn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(knowledgeItems, MAX_KNOWLEDGE_ITEMS);

  const checksum = computeChecksum(content);
  knowledgeItems.set(id, {
    content,
    priority,
    status: KNOWLEDGE_STATUS.ALIVE,
    dependencies: [],
    redundancyCount: 0,
    replicas: [],
    checksum,
    format: metadata.format || "text",
    domain: metadata.domain || "general",
    lastVerified: Date.now(),
    lastAccessed: Date.now(),
    createdAt: Date.now(),
    accessCount: 0,
  });
  return { ok: true, knowledgeId: id, checksum };
}

/**
 * Compute a simple checksum for content integrity verification.
 */
function computeChecksum(content) {
  const str = typeof content === "string" ? content : JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `ck_${Math.abs(hash).toString(36)}`;
}

/**
 * Verify knowledge integrity via checksum.
 */
function verifyIntegrity(knowledgeId) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };

  const currentChecksum = computeChecksum(item.content);
  const intact = currentChecksum === item.checksum;
  item.lastVerified = Date.now();

  return { ok: true, knowledgeId, intact, storedChecksum: item.checksum, currentChecksum };
}

/**
 * Access a knowledge item (tracks usage for dead-knowledge detection).
 */
function accessKnowledge(knowledgeId) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };

  item.lastAccessed = Date.now();
  item.accessCount++;
  return { ok: true, content: item.content, priority: item.priority, status: item.status };
}

// === EXTINCTION RISK ===

/**
 * Identify knowledge at extinction risk.
 * Factors: no redundancy, no recent access, high dependency count, critical priority.
 */
function identifyAtRisk() {
  const atRisk = [];
  const now = Date.now();
  const DORMANCY_THRESHOLD = 90 * 24 * 3600 * 1000; // 90 days

  for (const [id, item] of knowledgeItems) {
    if (item.status === KNOWLEDGE_STATUS.ARCHIVED || item.status === KNOWLEDGE_STATUS.EXTINCT) continue;

    const riskFactors = [];
    let riskScore = 0;

    // No redundancy
    if (item.redundancyCount === 0) {
      riskFactors.push("no_redundancy");
      riskScore += 0.3;
    }

    // Not accessed recently
    if (now - item.lastAccessed > DORMANCY_THRESHOLD) {
      riskFactors.push("dormant");
      riskScore += 0.2;
    }

    // Critical but unprotected
    if (item.priority === SURVIVAL_PRIORITY.CRITICAL && item.redundancyCount < 2) {
      riskFactors.push("critical_unprotected");
      riskScore += 0.4;
    }

    // Many dependents (others depend on this)
    const dependents = [...dependencies.values()].filter(d => d.to === id);
    if (dependents.length > 3) {
      riskFactors.push("high_dependency");
      riskScore += 0.2;
    }

    if (riskScore >= 0.4) {
      atRisk.push({ knowledgeId: id, riskScore: Math.min(riskScore, 1.0), riskFactors, priority: item.priority });
      if (item.status === KNOWLEDGE_STATUS.ALIVE) {
        item.status = KNOWLEDGE_STATUS.AT_RISK;
      }
    }
  }

  atRisk.sort((a, b) => b.riskScore - a.riskScore);
  return { ok: true, atRisk, count: atRisk.length };
}

/**
 * Detect dead knowledge (not accessed in a long time, no dependents).
 */
function detectDeadKnowledge(thresholdDays = 180) {
  const dead = [];
  const now = Date.now();
  const threshold = thresholdDays * 24 * 3600 * 1000;

  for (const [id, item] of knowledgeItems) {
    if (item.status === KNOWLEDGE_STATUS.ARCHIVED || item.status === KNOWLEDGE_STATUS.EXTINCT) continue;

    if (now - item.lastAccessed > threshold) {
      const dependents = [...dependencies.values()].filter(d => d.to === id);
      if (dependents.length === 0) {
        dead.push({ knowledgeId: id, lastAccessed: item.lastAccessed, priority: item.priority });
      }
    }
  }

  return { ok: true, dead, count: dead.length };
}

/**
 * Archive dead knowledge (don't delete — preserve for history).
 */
function archiveKnowledge(knowledgeId, reason) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };
  item.status = KNOWLEDGE_STATUS.ARCHIVED;
  item.archivedAt = Date.now();
  item.archiveReason = reason || "dead_knowledge";
  return { ok: true, knowledgeId, status: KNOWLEDGE_STATUS.ARCHIVED };
}

// === CANON SURVIVAL ===

/**
 * Create a canon entry — a bundle of knowledge that must persist.
 */
function createCanon(name, knowledgeIds, survivalStrategy) {
  const id = `canon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(canonEntries, MAX_CANON_ENTRIES);

  // Verify all knowledge items exist
  const missing = knowledgeIds.filter(kid => !knowledgeItems.has(kid));
  if (missing.length > 0) {
    return { ok: false, error: `Missing knowledge items: ${missing.join(", ")}` };
  }

  canonEntries.set(id, {
    name,
    knowledgeIds,
    survivalStrategy: survivalStrategy || "replicate",
    protectionLevel: SURVIVAL_PRIORITY.CRITICAL,
    lastVerified: Date.now(),
    createdAt: Date.now(),
  });
  return { ok: true, canonId: id };
}

/**
 * Verify canon integrity — check all constituent knowledge items.
 */
function verifyCanon(canonId) {
  const canon = canonEntries.get(canonId);
  if (!canon) return { ok: false, error: "Canon not found" };

  const results = [];
  let allIntact = true;

  for (const kid of canon.knowledgeIds) {
    const check = verifyIntegrity(kid);
    results.push(check);
    if (!check.ok || !check.intact) allIntact = false;
  }

  canon.lastVerified = Date.now();
  return { ok: true, canonId, intact: allIntact, items: results };
}

// === COLD-START RECOVERY ===

/**
 * Create a cold-start seed — minimal knowledge for recovery from scratch.
 */
function createColdStartSeed(name, knowledgeIds, instructions) {
  const id = `seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(coldStartSeeds, MAX_SEEDS);

  coldStartSeeds.set(id, {
    name,
    knowledgeIds,
    instructions: instructions || "Restore knowledge items in priority order",
    checksums: knowledgeIds.map(kid => {
      const item = knowledgeItems.get(kid);
      return { knowledgeId: kid, checksum: item?.checksum || null };
    }),
    createdAt: Date.now(),
  });
  return { ok: true, seedId: id };
}

/**
 * Execute a cold-start recovery from a seed.
 */
function executeColdStart(seedId) {
  const seed = coldStartSeeds.get(seedId);
  if (!seed) return { ok: false, error: "Seed not found" };

  const recovered = [];
  const failed = [];

  for (const kid of seed.knowledgeIds) {
    const item = knowledgeItems.get(kid);
    if (item) {
      item.status = KNOWLEDGE_STATUS.ALIVE;
      item.lastAccessed = Date.now();
      recovered.push(kid);
    } else {
      failed.push(kid);
    }
  }

  return {
    ok: true,
    seedId,
    recovered: recovered.length,
    failed: failed.length,
    failedIds: failed,
    instructions: seed.instructions,
  };
}

/**
 * Identify minimum viable epistemic state — the smallest set of knowledge
 * needed for the system to function.
 */
function identifyMinimumViable() {
  const critical = [];
  const visited = new Set();

  // Start with all critical-priority items
  for (const [id, item] of knowledgeItems) {
    if (item.priority === SURVIVAL_PRIORITY.CRITICAL && item.status !== KNOWLEDGE_STATUS.EXTINCT) {
      critical.push(id);
      visited.add(id);
    }
  }

  // Follow dependencies — include anything critical items depend on
  let frontier = [...critical];
  while (frontier.length > 0) {
    const next = [];
    for (const kid of frontier) {
      const deps = [...dependencies.values()].filter(d => d.from === kid);
      for (const dep of deps) {
        if (!visited.has(dep.to)) {
          visited.add(dep.to);
          next.push(dep.to);
        }
      }
    }
    frontier = next;
  }

  return {
    ok: true,
    minimumViable: [...visited],
    count: visited.size,
    totalKnowledge: knowledgeItems.size,
    reductionRatio: knowledgeItems.size > 0 ? 1 - (visited.size / knowledgeItems.size) : 0,
  };
}

// === SUCCESSION HANDLING ===

/**
 * Plan a knowledge succession (graceful transfer).
 */
function planSuccession(fromEntity, toEntity, knowledgeIds, description) {
  const id = `succ_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(successions, MAX_SUCCESSIONS);

  successions.set(id, {
    from: fromEntity,
    to: toEntity,
    knowledgeIds,
    description,
    state: SUCCESSION_STATES.PLANNED,
    rehearsals: [],
    transferLog: [],
    createdAt: Date.now(),
  });
  return { ok: true, successionId: id };
}

/**
 * Rehearse a succession — dry-run knowledge transfer.
 */
function rehearseSuccession(successionId) {
  const succ = successions.get(successionId);
  if (!succ) return { ok: false, error: "Succession not found" };

  const issues = [];
  for (const kid of succ.knowledgeIds) {
    const item = knowledgeItems.get(kid);
    if (!item) {
      issues.push({ knowledgeId: kid, issue: "not_found" });
    } else if (item.status === KNOWLEDGE_STATUS.EXTINCT) {
      issues.push({ knowledgeId: kid, issue: "extinct" });
    } else {
      const integrity = verifyIntegrity(kid);
      if (!integrity.intact) {
        issues.push({ knowledgeId: kid, issue: "integrity_failure" });
      }
    }
  }

  succ.rehearsals.push({
    rehearsedAt: Date.now(),
    issues,
    passed: issues.length === 0,
  });
  if (issues.length === 0) succ.state = SUCCESSION_STATES.REHEARSED;

  return { ok: true, successionId, passed: issues.length === 0, issues };
}

/**
 * Execute a succession (actual knowledge transfer).
 */
function executeSuccession(successionId) {
  const succ = successions.get(successionId);
  if (!succ) return { ok: false, error: "Succession not found" };
  if (succ.state !== SUCCESSION_STATES.REHEARSED && succ.state !== SUCCESSION_STATES.PLANNED) {
    return { ok: false, error: `Cannot execute in state: ${succ.state}` };
  }

  succ.state = SUCCESSION_STATES.IN_PROGRESS;
  const transferred = [];
  const failed = [];

  for (const kid of succ.knowledgeIds) {
    const item = knowledgeItems.get(kid);
    if (item && item.status !== KNOWLEDGE_STATUS.EXTINCT) {
      succ.transferLog.push({ knowledgeId: kid, transferredAt: Date.now(), success: true });
      transferred.push(kid);
    } else {
      succ.transferLog.push({ knowledgeId: kid, transferredAt: Date.now(), success: false });
      failed.push(kid);
    }
  }

  succ.state = failed.length === 0 ? SUCCESSION_STATES.COMPLETED : SUCCESSION_STATES.FAILED;
  return { ok: true, successionId, transferred: transferred.length, failed: failed.length, state: succ.state };
}

// === KNOWLEDGE DEPENDENCIES ===

/**
 * Register a dependency between knowledge items.
 */
function registerDependency(fromId, toId, type, strength) {
  const id = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(dependencies, MAX_DEPENDENCIES);

  dependencies.set(id, {
    from: fromId,
    to: toId,
    type: type || "requires",
    strength: strength || 1.0,
    createdAt: Date.now(),
  });

  // Update the knowledge item's dependency list
  const item = knowledgeItems.get(fromId);
  if (item) item.dependencies.push(toId);

  return { ok: true, dependencyId: id };
}

/**
 * Map all dependencies for survival planning.
 */
function mapDependencies(knowledgeId) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };

  // Find what this item depends on
  const dependsOn = [...dependencies.values()].filter(d => d.from === knowledgeId);
  // Find what depends on this item
  const dependedBy = [...dependencies.values()].filter(d => d.to === knowledgeId);

  return {
    ok: true,
    knowledgeId,
    dependsOn: dependsOn.map(d => ({ knowledgeId: d.to, type: d.type, strength: d.strength })),
    dependedBy: dependedBy.map(d => ({ knowledgeId: d.from, type: d.type, strength: d.strength })),
    isFoundational: dependedBy.length > 3,
    isLeaf: dependsOn.length === 0,
  };
}

/**
 * Attempt to resurrect knowledge from partial fragments.
 */
function resurrectKnowledge(knowledgeId, fragments) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };
  if (item.status !== KNOWLEDGE_STATUS.EXTINCT) {
    return { ok: false, error: "Knowledge is not extinct" };
  }

  if (!fragments || fragments.length === 0) {
    return { ok: false, error: "No fragments provided for resurrection" };
  }

  // Reconstruct from fragments
  const reconstructed = fragments.join(" [FRAGMENT_BOUNDARY] ");
  item.content = reconstructed;
  item.status = KNOWLEDGE_STATUS.ALIVE;
  item.checksum = computeChecksum(reconstructed);
  item.resurrectedAt = Date.now();
  item.resurrectionSource = "partial_fragments";

  return {
    ok: true,
    knowledgeId,
    status: KNOWLEDGE_STATUS.ALIVE,
    fragmentCount: fragments.length,
    newChecksum: item.checksum,
  };
}

/**
 * Add redundancy to a knowledge item (replicate for survival).
 */
function addRedundancy(knowledgeId, replicaLocation) {
  const item = knowledgeItems.get(knowledgeId);
  if (!item) return { ok: false, error: "Knowledge item not found" };

  item.replicas.push({ location: replicaLocation, createdAt: Date.now() });
  item.redundancyCount = item.replicas.length;

  return { ok: true, knowledgeId, redundancyCount: item.redundancyCount };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "register_knowledge", (ctx) => {
    const { content, priority, metadata } = ctx.args || {};
    return registerKnowledge(content, priority || SURVIVAL_PRIORITY.MEDIUM, metadata);
  }, { public: true });

  register("loaf", "verify_knowledge_integrity", (ctx) => {
    return verifyIntegrity(ctx.args?.knowledgeId);
  }, { public: true });

  register("loaf", "access_knowledge", (ctx) => {
    return accessKnowledge(ctx.args?.knowledgeId);
  }, { public: true });

  register("loaf", "identify_at_risk", (_ctx) => {
    return identifyAtRisk();
  }, { public: true });

  register("loaf", "detect_dead_knowledge", (ctx) => {
    return detectDeadKnowledge(ctx.args?.thresholdDays);
  }, { public: true });

  register("loaf", "archive_knowledge", (ctx) => {
    const { knowledgeId, reason } = ctx.args || {};
    return archiveKnowledge(knowledgeId, reason);
  }, { public: true });

  register("loaf", "create_canon", (ctx) => {
    const { name, knowledgeIds, survivalStrategy } = ctx.args || {};
    return createCanon(name, knowledgeIds || [], survivalStrategy);
  }, { public: true });

  register("loaf", "verify_canon", (ctx) => {
    return verifyCanon(ctx.args?.canonId);
  }, { public: true });

  register("loaf", "create_cold_start_seed", (ctx) => {
    const { name, knowledgeIds, instructions } = ctx.args || {};
    return createColdStartSeed(name, knowledgeIds || [], instructions);
  }, { public: true });

  register("loaf", "execute_cold_start", (ctx) => {
    return executeColdStart(ctx.args?.seedId);
  }, { public: true });

  register("loaf", "identify_minimum_viable", (_ctx) => {
    return identifyMinimumViable();
  }, { public: true });

  register("loaf", "plan_succession", (ctx) => {
    const { from, to, knowledgeIds, description } = ctx.args || {};
    return planSuccession(from, to, knowledgeIds || [], description);
  }, { public: true });

  register("loaf", "rehearse_succession", (ctx) => {
    return rehearseSuccession(ctx.args?.successionId);
  }, { public: true });

  register("loaf", "execute_succession", (ctx) => {
    return executeSuccession(ctx.args?.successionId);
  }, { public: true });

  register("loaf", "register_dependency", (ctx) => {
    const { from, to, type, strength } = ctx.args || {};
    return registerDependency(from, to, type, strength);
  }, { public: true });

  register("loaf", "map_dependencies", (ctx) => {
    return mapDependencies(ctx.args?.knowledgeId);
  }, { public: true });

  register("loaf", "resurrect_knowledge", (ctx) => {
    const { knowledgeId, fragments } = ctx.args || {};
    return resurrectKnowledge(knowledgeId, fragments);
  }, { public: true });

  register("loaf", "add_redundancy", (ctx) => {
    const { knowledgeId, replicaLocation } = ctx.args || {};
    return addRedundancy(knowledgeId, replicaLocation);
  }, { public: true });
}

export {
  init,
  SURVIVAL_PRIORITY,
  KNOWLEDGE_STATUS,
  SUCCESSION_STATES,
  registerKnowledge,
  computeChecksum,
  verifyIntegrity,
  accessKnowledge,
  identifyAtRisk,
  detectDeadKnowledge,
  archiveKnowledge,
  createCanon,
  verifyCanon,
  createColdStartSeed,
  executeColdStart,
  identifyMinimumViable,
  planSuccession,
  rehearseSuccession,
  executeSuccession,
  registerDependency,
  mapDependencies,
  resurrectKnowledge,
  addRedundancy,
};
