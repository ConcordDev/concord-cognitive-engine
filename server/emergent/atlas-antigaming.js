/**
 * Concord Global Atlas — Anti-Gaming System
 *
 * Ring/cycle detection, unique-source enforcement, author influence caps,
 * spam throttles, and duplicate detection to prevent gaming of the Atlas.
 */

import { getAtlasState } from "./atlas-epistemic.js";

// ── Configuration ────────────────────────────────────────────────────────

const ANTIGAMING_CONFIG = {
  // Author influence caps
  MAX_SINGLE_AUTHOR_CONFIDENCE_CONTRIBUTION: 0.25,
  MAX_SAME_AUTHOR_SUPPORT_LINKS: 5,

  // Unique source rules
  MIN_UNIQUE_PUBLISHERS_FOR_CORROBORATED: 2,

  // Spam throttles
  MAX_PROPOSED_PER_USER_PER_HOUR: 20,
  MAX_PROPOSED_PER_DOMAIN_PER_HOUR: 50,
  MAX_LINKS_PER_USER_PER_HOUR: 30,

  // Duplicate thresholds
  SIMILARITY_THRESHOLD: 0.65,
  TITLE_OVERLAP_THRESHOLD: 0.70,

  // Cycle detection
  MAX_LINEAGE_DEPTH_CHECK: 50,
  MAX_SUPPORT_RING_SIZE: 10,
};

// ── Rate Tracking State ──────────────────────────────────────────────────

const rateBuckets = new Map(); // `${userId}:${action}` → { count, windowStart }
const HOUR_MS = 3600000;

function checkRate(userId, action, limit) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > HOUR_MS) {
    bucket = { count: 0, windowStart: now };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return {
    allowed: bucket.count <= limit,
    current: bucket.count,
    limit,
    resetsAt: bucket.windowStart + HOUR_MS,
  };
}

// Periodic cleanup
// @resource-leak-ok: process-lifetime — anti-gaming detector tick
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.windowStart > HOUR_MS * 2) rateBuckets.delete(key);
  }
}, HOUR_MS).unref();

// ── Cycle Detection ──────────────────────────────────────────────────────

/**
 * Detect lineage cycles: DTU lineage cannot include itself.
 * Returns { hasCycle, path } if a cycle is found.
 */
export function detectLineageCycle(STATE, dtuId) {
  const atlas = getAtlasState(STATE);
  const visited = new Set();
  const path = [];

  function dfs(currentId, depth) {
    if (depth > ANTIGAMING_CONFIG.MAX_LINEAGE_DEPTH_CHECK) return false;
    if (visited.has(currentId)) {
      path.push(currentId);
      return true;
    }

    visited.add(currentId);
    path.push(currentId);

    const dtu = atlas.dtus.get(currentId);
    if (!dtu?.lineage?.parents) return false;

    for (const parent of dtu.lineage.parents) {
      if (parent.dtuId === dtuId) {
        path.push(parent.dtuId);
        return true; // cycle back to original
      }
      if (dfs(parent.dtuId, depth + 1)) return true;
    }

    path.pop();
    return false;
  }

  const hasCycle = dfs(dtuId, 0);
  return { hasCycle, path: hasCycle ? path : [] };
}

/**
 * Detect citation/support rings: A supports B supports C supports A.
 * Ring detection reduces support weight contributions.
 */
export function detectSupportRing(STATE, dtuId) {
  const atlas = getAtlasState(STATE);
  const visited = new Set();
  const rings = [];

  function dfs(currentId, path, depth) {
    if (depth > ANTIGAMING_CONFIG.MAX_SUPPORT_RING_SIZE) return;
    if (visited.has(currentId)) {
      const cycleStart = path.indexOf(currentId);
      if (cycleStart >= 0) {
        rings.push(path.slice(cycleStart).concat(currentId));
      }
      return;
    }

    visited.add(currentId);
    path.push(currentId);

    const dtu = atlas.dtus.get(currentId);
    if (!dtu?.links?.supports) {
      path.pop();
      return;
    }

    for (const link of dtu.links.supports) {
      dfs(link.targetDtuId, [...path], depth + 1);
    }

    path.pop();
  }

  dfs(dtuId, [], 0);
  return { hasRings: rings.length > 0, rings };
}

// ── Unique Source Enforcement ────────────────────────────────────────────

/**
 * Check that corroboration counts only unique sources by canonical URL/publisher.
 * Prevents "10 copies of the same article" boosting confidence.
 */
export function analyzeSourceUniqueness(atlasDtu) {
  const allSources = [];
  for (const claim of (atlasDtu.claims || [])) {
    for (const src of (claim.sources || [])) {
      allSources.push(src);
    }
  }

  // Group by canonical URL
  const byUrl = new Map();
  for (const src of allSources) {
    const key = src.url?.toLowerCase().replace(/\/$/, "") || `untitled_${src.title || ""}`;
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(src);
  }

  // Group by publisher
  const byPublisher = new Map();
  for (const src of allSources) {
    const pub = (src.publisher || "unknown").toLowerCase();
    if (!byPublisher.has(pub)) byPublisher.set(pub, []);
    byPublisher.get(pub).push(src);
  }

  const duplicatedUrls = [];
  for (const [url, sources] of byUrl) {
    if (sources.length > 1) {
      duplicatedUrls.push({ url, count: sources.length });
    }
  }

  const uniquePublishers = byPublisher.size;
  const uniqueUrls = byUrl.size;

  return {
    totalSources: allSources.length,
    uniqueUrls,
    uniquePublishers,
    duplicatedUrls,
    meetsCorroborationRequirement: uniquePublishers >= ANTIGAMING_CONFIG.MIN_UNIQUE_PUBLISHERS_FOR_CORROBORATED,
  };
}

// ── Author Influence Caps ────────────────────────────────────────────────

/**
 * Check if a single author is dominating confidence scoring.
 * One author can't push confidence past a ceiling without external corroboration.
 */
export function checkAuthorInfluence(STATE, dtuId) {
  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };

  // Check support links — how many are from the same author?
  const supportLinks = dtu.links?.supports || [];
  const authorCounts = new Map();

  for (const link of supportLinks) {
    const supportingDtu = atlas.dtus.get(link.targetDtuId);
    if (supportingDtu?.author?.userId) {
      const author = supportingDtu.author.userId;
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    }
  }

  // Check if any single author exceeds the cap
  const violations = [];
  for (const [author, count] of authorCounts) {
    if (count > ANTIGAMING_CONFIG.MAX_SAME_AUTHOR_SUPPORT_LINKS) {
      violations.push({
        authorId: author,
        supportCount: count,
        max: ANTIGAMING_CONFIG.MAX_SAME_AUTHOR_SUPPORT_LINKS,
        influence: Math.min(
          ANTIGAMING_CONFIG.MAX_SINGLE_AUTHOR_CONFIDENCE_CONTRIBUTION,
          (count / supportLinks.length) * (dtu.scores?.confidence_overall || 0)
        ),
      });
    }
  }

  // Compute effective author diversity
  const totalAuthors = authorCounts.size;
  const diversityScore = totalAuthors > 0 ? Math.min(1.0, totalAuthors / 3) : 0;

  return {
    ok: true,
    dtuId,
    authorCounts: Object.fromEntries(authorCounts),
    violations,
    isCapped: violations.length > 0,
    diversityScore,
    cappedConfidenceMax: violations.length > 0
      ? ANTIGAMING_CONFIG.MAX_SINGLE_AUTHOR_CONFIDENCE_CONTRIBUTION
      : null,
  };
}

// ── Spam Throttle ────────────────────────────────────────────────────────

/**
 * Check rate limits for DTU creation, linking, and promotion.
 */
export function checkSpamThrottle(userId, action) {
  const limits = {
    "create_proposed": ANTIGAMING_CONFIG.MAX_PROPOSED_PER_USER_PER_HOUR,
    "create_link": ANTIGAMING_CONFIG.MAX_LINKS_PER_USER_PER_HOUR,
    "domain_proposed": ANTIGAMING_CONFIG.MAX_PROPOSED_PER_DOMAIN_PER_HOUR,
  };

  const limit = limits[action];
  if (!limit) return { allowed: true, action };

  return checkRate(userId, action, limit);
}

// ── Duplicate / Similarity Detection ─────────────────────────────────────

/**
 * Compute similarity between two Atlas DTUs.
 * Uses title overlap + claim word overlap + tag Jaccard.
 */
export function computeSimilarity(dtuA, dtuB) {
  // Title overlap
  const titleA = (dtuA.title || "").toLowerCase().split(/\s+/);
  const titleB = (dtuB.title || "").toLowerCase().split(/\s+/);
  const titleOverlap = jaccardSimilarity(new Set(titleA), new Set(titleB));

  // Claim word overlap
  const claimWordsA = new Set();
  for (const c of (dtuA.claims || [])) {
    for (const w of (c.text || "").toLowerCase().split(/\s+/)) claimWordsA.add(w);
  }
  const claimWordsB = new Set();
  for (const c of (dtuB.claims || [])) {
    for (const w of (c.text || "").toLowerCase().split(/\s+/)) claimWordsB.add(w);
  }
  const claimOverlap = jaccardSimilarity(claimWordsA, claimWordsB);

  // Tag Jaccard
  const tagsA = new Set(dtuA.tags || []);
  const tagsB = new Set(dtuB.tags || []);
  const tagOverlap = jaccardSimilarity(tagsA, tagsB);

  // Weighted average
  const similarity = titleOverlap * 0.3 + claimOverlap * 0.5 + tagOverlap * 0.2;

  return {
    similarity: Math.round(similarity * 1000) / 1000,
    titleOverlap: Math.round(titleOverlap * 1000) / 1000,
    claimOverlap: Math.round(claimOverlap * 1000) / 1000,
    tagOverlap: Math.round(tagOverlap * 1000) / 1000,
    isDuplicate: similarity > ANTIGAMING_CONFIG.SIMILARITY_THRESHOLD,
  };
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Find near-duplicates for a candidate DTU within the same domainType.
 */
export function findNearDuplicates(STATE, candidateDtu, maxResults = 5) {
  const atlas = getAtlasState(STATE);
  const domainSet = atlas.byDomainType.get(candidateDtu.domainType);
  if (!domainSet) return { ok: true, duplicates: [] };

  const duplicates = [];
  for (const existingId of domainSet) {
    const existing = atlas.dtus.get(existingId);
    if (!existing) continue;

    const sim = computeSimilarity(candidateDtu, existing);
    if (sim.isDuplicate) {
      duplicates.push({
        existingId,
        existingTitle: existing.title,
        ...sim,
      });
    }
  }

  // Sort by similarity desc
  duplicates.sort((a, b) => b.similarity - a.similarity);

  return {
    ok: true,
    duplicates: duplicates.slice(0, maxResults),
    hasDuplicates: duplicates.length > 0,
  };
}

// ── Content Hash Dedup ───────────────────────────────────────────────────

/**
 * Check if a content hash already exists in the atlas.
 */
export function checkContentHashDedup(STATE, hash) {
  const atlas = getAtlasState(STATE);
  for (const dtu of atlas.dtus.values()) {
    if (dtu.lineage?.hash === hash) {
      return { isDuplicate: true, existingId: dtu.id, existingTitle: dtu.title };
    }
  }
  return { isDuplicate: false };
}

// ── Comprehensive Anti-Gaming Scan ───────────────────────────────────────

/**
 * Run all anti-gaming checks on a candidate Atlas DTU.
 * Returns a comprehensive report with pass/fail for each check.
 */
export function runAntiGamingScan(STATE, dtuId, authorUserId) {
  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };

  const results = {
    lineageCycle: detectLineageCycle(STATE, dtuId),
    supportRing: detectSupportRing(STATE, dtuId),
    sourceUniqueness: analyzeSourceUniqueness(dtu),
    authorInfluence: checkAuthorInfluence(STATE, dtuId),
    spamCheck: checkSpamThrottle(authorUserId, "create_proposed"),
    nearDuplicates: findNearDuplicates(STATE, dtu),
  };

  // Determine if DTU should be quarantined
  const shouldQuarantine =
    results.lineageCycle.hasCycle ||
    results.supportRing.hasRings ||
    results.authorInfluence.isCapped ||
    !results.spamCheck.allowed;

  const shouldWarn =
    !results.sourceUniqueness.meetsCorroborationRequirement ||
    results.nearDuplicates.hasDuplicates;

  return {
    ok: true,
    dtuId,
    passed: !shouldQuarantine,
    shouldQuarantine,
    shouldWarn,
    results,
    summary: shouldQuarantine
      ? "DTU flagged for quarantine due to gaming signals"
      : shouldWarn
        ? "DTU has warnings but passes anti-gaming checks"
        : "DTU passes all anti-gaming checks",
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────

export function getAntiGamingMetrics() {
  return {
    ok: true,
    activeBuckets: rateBuckets.size,
    config: { ...ANTIGAMING_CONFIG },
  };
}
