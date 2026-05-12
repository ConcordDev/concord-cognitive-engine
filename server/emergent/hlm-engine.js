/**
 * HLM (High-Level Mapping) Engine
 *
 * Prevents the lattice from becoming incomprehensible at scale by organizing
 * DTUs into meaningful structure. HLM operates as a periodic analysis pass
 * that produces topology maps and actionable recommendations.
 *
 * HLM Operations:
 *   - Cluster: group related DTUs into named clusters
 *   - Bridge: identify DTUs connecting otherwise separate clusters
 *   - Orphan rescue: find disconnected DTUs, suggest placements
 *   - Redundancy sweep: find near-duplicates for merge
 *   - Gap detection: find missing connections within clusters
 *   - Hierarchy check: verify MEGA/HYPER promotions appropriate
 *   - Tag normalization: standardize tags across DTUs
 *   - Lineage audit: verify parent-child relationships
 *   - Domain census: count DTUs per domain, find imbalances
 *   - Freshness check: identify stale DTUs
 *
 * HLM Triggers:
 *   - Scheduled (every N hours)
 *   - After large ingest batches
 *   - After MEGA/HYPER promotion
 *   - Sovereign command
 *
 * Additive only. Silent failure. No existing logic changes.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Configuration ───────────────────────────────────────────────────────────

const MIN_CLUSTER_SIZE = 3;
const MAX_CLUSTERS = 100;
const SIMILARITY_THRESHOLD = 0.85;
const STALE_DAYS = 90;

// ── In-Memory State ─────────────────────────────────────────────────────────

const hlmPasses = new Map();        // passId → pass result
const hlmRecommendations = new LruMap(); // recId → recommendation
const hlmMetricsStore = {
  totalPasses: 0,
  totalClusters: 0,
  totalOrphans: 0,
  totalRedundancies: 0,
  totalGaps: 0,
  totalRecommendations: 0,
  lastPassAt: null,
  lastPassId: null,
};

// ── Tag Similarity ──────────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two tag arrays.
 */
function tagSimilarity(tagsA, tagsB) {
  if (!tagsA?.length || !tagsB?.length) return 0;
  const setA = new Set(tagsA.map(t => String(t).toLowerCase().trim()));
  const setB = new Set(tagsB.map(t => String(t).toLowerCase().trim()));
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute text similarity between two strings using character bigrams.
 */
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const sa = String(a).toLowerCase().trim();
  const sb = String(b).toLowerCase().trim();
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;

  const bigramsA = new Set();
  for (let i = 0; i < sa.length - 1; i++) bigramsA.add(sa.slice(i, i + 2));
  const bigramsB = new Set();
  for (let i = 0; i < sb.length - 1; i++) bigramsB.add(sb.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  const union = new Set([...bigramsA, ...bigramsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute overall similarity between two DTUs.
 * Combines tag overlap, summary similarity, and domain match.
 */
function dtuSimilarity(a, b) {
  if (!a || !b) return 0;
  const tagSim = tagSimilarity(a.tags, b.tags);
  const summarySim = textSimilarity(
    a.human?.summary || "",
    b.human?.summary || ""
  );
  const domainMatch = a.domain && b.domain && a.domain === b.domain ? 1 : 0;
  return clamp01(tagSim * 0.5 + summarySim * 0.3 + domainMatch * 0.2);
}

// ── Lineage Proximity ───────────────────────────────────────────────────────

/**
 * Check if two DTUs share lineage (same parent or ancestor chain).
 */
function shareLineage(a, b) {
  if (!a || !b) return false;
  if (a.parentId && a.parentId === b.parentId) return true;
  if (a.parentId === b.id || b.parentId === a.id) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CLUSTER ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cluster DTUs by tag overlap + lineage proximity.
 * Step 1 of HLM process.
 *
 * Greedy agglomerative clustering:
 *   - Seed clusters from DTUs sharing >= 2 tags or direct lineage
 *   - Merge overlapping clusters until stable
 *   - Name clusters from most common tags
 *   - Enforce min cluster size 3, max clusters 100
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {{ clusters: Object[], unassigned: string[] }}
 */
export function clusterAnalysis(dtus) {
  try {
    if (!Array.isArray(dtus) || dtus.length === 0) {
      return { clusters: [], unassigned: [] };
    }

    // Build adjacency: DTU pairs that belong together
    const dtuMap = new Map();
    for (const d of dtus) {
      if (d?.id) dtuMap.set(d.id, d);
    }
    const ids = Array.from(dtuMap.keys());

    // Union-Find for clustering
    const parent = new Map();
    const rank = new Map();
    for (const id of ids) {
      parent.set(id, id);
      rank.set(id, 0);
    }

    function find(x) {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root);
      // Path compression
      let curr = x;
      while (curr !== root) {
        const next = parent.get(curr);
        parent.set(curr, root);
        curr = next;
      }
      return root;
    }

    function unite(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      const rankA = rank.get(ra);
      const rankB = rank.get(rb);
      if (rankA < rankB) {
        parent.set(ra, rb);
      } else if (rankA > rankB) {
        parent.set(rb, ra);
      } else {
        parent.set(rb, ra);
        rank.set(ra, rankA + 1);
      }
    }

    // Unite DTUs that share >= 2 tags or share lineage
    for (let i = 0; i < ids.length; i++) {
      const a = dtuMap.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const b = dtuMap.get(ids[j]);

        // Tag overlap check
        const aTags = (a.tags || []).map(t => String(t).toLowerCase().trim());
        const bTags = (b.tags || []).map(t => String(t).toLowerCase().trim());
        let overlap = 0;
        const bSet = new Set(bTags);
        for (const t of aTags) {
          if (bSet.has(t)) overlap++;
        }

        if (overlap >= 2 || shareLineage(a, b)) {
          unite(ids[i], ids[j]);
        }
      }
    }

    // Collect clusters
    const clusterMap = new Map(); // root → [ids]
    for (const id of ids) {
      const root = find(id);
      if (!clusterMap.has(root)) clusterMap.set(root, []);
      clusterMap.get(root).push(id);
    }

    // Filter by min size, sort by size descending, cap at MAX_CLUSTERS
    const rawClusters = Array.from(clusterMap.values())
      .filter(members => members.length >= MIN_CLUSTER_SIZE)
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_CLUSTERS);

    // Determine unassigned DTUs
    const assignedIds = new Set();
    for (const members of rawClusters) {
      for (const id of members) assignedIds.add(id);
    }
    const unassigned = ids.filter(id => !assignedIds.has(id));

    // Build cluster objects with names derived from most common tags
    const clusters = rawClusters.map((members, idx) => {
      const tagFreq = new Map();
      const domains = new Map();
      for (const id of members) {
        const d = dtuMap.get(id);
        for (const t of (d.tags || [])) {
          const norm = String(t).toLowerCase().trim();
          tagFreq.set(norm, (tagFreq.get(norm) || 0) + 1);
        }
        if (d.domain) {
          domains.set(d.domain, (domains.get(d.domain) || 0) + 1);
        }
      }

      const topTags = Array.from(tagFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);

      const topDomain = Array.from(domains.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || "general";

      const name = topTags.length > 0
        ? topTags.slice(0, 3).join("-")
        : `cluster-${idx}`;

      return {
        clusterId: uid("clst"),
        name,
        members,
        size: members.length,
        topTags,
        primaryDomain: topDomain,
        createdAt: nowISO(),
      };
    });

    return { clusters, unassigned };
  } catch {
    return { clusters: [], unassigned: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GAP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find gaps within clusters.
 * Step 2 of HLM process.
 *
 * For each cluster, examine tag coverage:
 *   "Cluster X has DTUs about A, B, C but nothing connecting B→C"
 *
 * A gap exists when two tags co-occur frequently in the cluster
 * but no single DTU carries both.
 *
 * @param {Object[]} clusters - Array of cluster objects from clusterAnalysis
 * @param {Object[]} [dtus] - Full DTU array for lookups
 * @returns {{ gaps: Object[] }}
 */
export function gapAnalysis(clusters, dtus) {
  try {
    if (!Array.isArray(clusters)) return { gaps: [] };

    const dtuMap = new Map();
    if (Array.isArray(dtus)) {
      for (const d of dtus) {
        if (d?.id) dtuMap.set(d.id, d);
      }
    }

    const gaps = [];

    for (const cluster of clusters) {
      if (!cluster?.members?.length) continue;

      // Collect all tags in this cluster
      const tagToDtus = new Map(); // tag → Set<dtuId>
      for (const id of cluster.members) {
        const d = dtuMap.get(id);
        if (!d) continue;
        for (const t of (d.tags || [])) {
          const norm = String(t).toLowerCase().trim();
          if (!tagToDtus.has(norm)) tagToDtus.set(norm, new Set());
          tagToDtus.get(norm).add(id);
        }
      }

      const tags = Array.from(tagToDtus.keys());

      // Find tag pairs where both tags appear in the cluster
      // but no DTU carries both
      for (let i = 0; i < tags.length; i++) {
        const dtusA = tagToDtus.get(tags[i]);
        if (dtusA.size < 2) continue; // Tag must be non-trivial

        for (let j = i + 1; j < tags.length; j++) {
          const dtusB = tagToDtus.get(tags[j]);
          if (dtusB.size < 2) continue;

          // Check if any DTU has both tags
          let hasBridge = false;
          for (const id of dtusA) {
            if (dtusB.has(id)) {
              hasBridge = true;
              break;
            }
          }

          if (!hasBridge) {
            gaps.push({
              gapId: uid("gap"),
              clusterId: cluster.clusterId,
              clusterName: cluster.name,
              tagA: tags[i],
              tagB: tags[j],
              tagACount: dtusA.size,
              tagBCount: dtusB.size,
              description: `Cluster "${cluster.name}" has DTUs about "${tags[i]}" and "${tags[j]}" but nothing connecting them`,
              detectedAt: nowISO(),
            });
          }
        }
      }
    }

    return { gaps };
  } catch {
    return { gaps: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. REDUNDANCY DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find near-duplicate DTUs for merge consideration.
 * Step 3 of HLM process.
 *
 * Similarity threshold 0.85. Preserve higher authority.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {{ redundancies: Object[] }}
 */
export function redundancyDetection(dtus) {
  try {
    if (!Array.isArray(dtus) || dtus.length < 2) {
      return { redundancies: [] };
    }

    const redundancies = [];
    const seen = new Set();

    for (let i = 0; i < dtus.length; i++) {
      const a = dtus[i];
      if (!a?.id) continue;

      for (let j = i + 1; j < dtus.length; j++) {
        const b = dtus[j];
        if (!b?.id) continue;

        const pairKey = [a.id, b.id].sort().join(":");
        if (seen.has(pairKey)) continue;

        const sim = dtuSimilarity(a, b);
        if (sim >= SIMILARITY_THRESHOLD) {
          seen.add(pairKey);

          const aAuthority = a.authority?.score || 0;
          const bAuthority = b.authority?.score || 0;
          const keep = aAuthority >= bAuthority ? a.id : b.id;
          const merge = aAuthority >= bAuthority ? b.id : a.id;

          redundancies.push({
            redundancyId: uid("rdnd"),
            dtuA: a.id,
            dtuB: b.id,
            similarity: Math.round(sim * 1000) / 1000,
            keepId: keep,
            mergeId: merge,
            keepAuthority: Math.max(aAuthority, bAuthority),
            mergeAuthority: Math.min(aAuthority, bAuthority),
            detectedAt: nowISO(),
          });
        }
      }
    }

    return { redundancies };
  } catch {
    return { redundancies: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ORPHAN RESCUE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find disconnected DTUs and suggest placements.
 *
 * An orphan is a DTU that:
 *   - Has no parentId
 *   - Is not a member of any cluster
 *   - Has fewer than 2 tags
 *
 * For each orphan, suggest the best-matching cluster based on tag affinity.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @param {Object[]} [clusters] - Optional pre-computed clusters
 * @returns {{ orphans: Object[] }}
 */
export function orphanRescue(dtus, clusters) {
  try {
    if (!Array.isArray(dtus)) return { orphans: [] };

    // If no clusters supplied, compute them
    let effectiveClusters = clusters;
    if (!effectiveClusters) {
      const result = clusterAnalysis(dtus);
      effectiveClusters = result.clusters;
    }

    // Build set of assigned DTU IDs
    const assignedIds = new Set();
    if (Array.isArray(effectiveClusters)) {
      for (const c of effectiveClusters) {
        for (const id of (c.members || [])) assignedIds.add(id);
      }
    }

    const orphans = [];

    for (const d of dtus) {
      if (!d?.id) continue;

      const isOrphan = !d.parentId && !assignedIds.has(d.id) && (d.tags || []).length < 2;
      if (!isOrphan) continue;

      // Find best cluster match
      let bestCluster = null;
      let bestScore = 0;

      for (const c of (effectiveClusters || [])) {
        // Compute average tag similarity to cluster members
        let simSum = 0;
        let count = 0;
        const dtuMap = new Map();
        for (const dd of dtus) {
          if (dd?.id) dtuMap.set(dd.id, dd);
        }
        for (const memberId of (c.members || [])) {
          const member = dtuMap.get(memberId);
          if (!member) continue;
          simSum += tagSimilarity(d.tags || [], member.tags || []);
          count++;
        }
        const avgSim = count > 0 ? simSum / count : 0;
        if (avgSim > bestScore) {
          bestScore = avgSim;
          bestCluster = c;
        }
      }

      orphans.push({
        orphanId: uid("orph"),
        dtuId: d.id,
        domain: d.domain || "unknown",
        tags: d.tags || [],
        suggestedCluster: bestCluster ? {
          clusterId: bestCluster.clusterId,
          clusterName: bestCluster.name,
          affinity: Math.round(bestScore * 1000) / 1000,
        } : null,
        detectedAt: nowISO(),
      });
    }

    return { orphans };
  } catch {
    return { orphans: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TOPOLOGY MAP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full topology output.
 * Step 4 of HLM process.
 *
 * Produces: clusters, bridges, orphans, hubs, gaps, redundancies.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {Object} Topology map
 */
export function topologyMap(dtus) {
  try {
    if (!Array.isArray(dtus) || dtus.length === 0) {
      return {
        topologyId: uid("topo"),
        clusters: [],
        bridges: [],
        orphans: [],
        hubs: [],
        gaps: [],
        redundancies: [],
        stats: { totalDtus: 0, clusterCount: 0, orphanCount: 0, bridgeCount: 0, hubCount: 0, gapCount: 0, redundancyCount: 0 },
        createdAt: nowISO(),
      };
    }

    const dtuMap = new Map();
    for (const d of dtus) {
      if (d?.id) dtuMap.set(d.id, d);
    }

    // Step 1: Clusters
    const { clusters, unassigned } = clusterAnalysis(dtus);

    // Step 2: Gaps
    const { gaps } = gapAnalysis(clusters, dtus);

    // Step 3: Redundancies
    const { redundancies } = redundancyDetection(dtus);

    // Step 4: Bridges — DTUs that appear connected to multiple clusters
    const bridges = findBridges(dtus, clusters, dtuMap);

    // Step 5: Hubs — DTUs with highest connectivity (most shared tags)
    const hubs = findHubs(dtus, dtuMap);

    // Step 6: Orphans
    const { orphans } = orphanRescue(dtus, clusters);

    const topology = {
      topologyId: uid("topo"),
      clusters,
      bridges,
      orphans,
      hubs,
      gaps,
      redundancies,
      stats: {
        totalDtus: dtus.length,
        clusterCount: clusters.length,
        orphanCount: orphans.length,
        bridgeCount: bridges.length,
        hubCount: hubs.length,
        gapCount: gaps.length,
        redundancyCount: redundancies.length,
      },
      createdAt: nowISO(),
    };

    return topology;
  } catch {
    return {
      topologyId: uid("topo"),
      clusters: [],
      bridges: [],
      orphans: [],
      hubs: [],
      gaps: [],
      redundancies: [],
      stats: { totalDtus: 0, clusterCount: 0, orphanCount: 0, bridgeCount: 0, hubCount: 0, gapCount: 0, redundancyCount: 0 },
      createdAt: nowISO(),
    };
  }
}

/**
 * Identify bridge DTUs — those that have strong tag overlap with
 * members of two or more distinct clusters.
 */
function findBridges(dtus, clusters, dtuMap) {
  const bridges = [];
  if (!clusters?.length || clusters.length < 2) return bridges;

  // For each DTU, check which clusters it has affinity to
  for (const d of dtus) {
    if (!d?.id) continue;
    const affinities = [];

    for (const c of clusters) {
      // Already a member? Skip — bridges connect clusters they aren't in
      if ((c.members || []).includes(d.id)) {
        affinities.push({ clusterId: c.clusterId, clusterName: c.name, score: 1 });
        continue;
      }

      // Check tag overlap with cluster's top tags
      const dTags = new Set((d.tags || []).map(t => String(t).toLowerCase().trim()));
      let overlap = 0;
      for (const t of (c.topTags || [])) {
        if (dTags.has(t)) overlap++;
      }
      const score = (c.topTags || []).length > 0
        ? overlap / c.topTags.length
        : 0;

      if (score >= 0.4) {
        affinities.push({ clusterId: c.clusterId, clusterName: c.name, score: Math.round(score * 1000) / 1000 });
      }
    }

    if (affinities.length >= 2) {
      bridges.push({
        bridgeId: uid("brdg"),
        dtuId: d.id,
        domain: d.domain || "unknown",
        connectedClusters: affinities,
        strength: clamp01(affinities.reduce((s, a) => s + a.score, 0) / affinities.length),
        detectedAt: nowISO(),
      });
    }
  }

  return bridges.sort((a, b) => b.connectedClusters.length - a.connectedClusters.length).slice(0, 50);
}

/**
 * Identify hub DTUs — those with the most tag connections to other DTUs.
 */
function findHubs(dtus, dtuMap) {
  const hubScores = [];

  for (const d of dtus) {
    if (!d?.id || !d.tags?.length) continue;

    let connectionCount = 0;
    const dTags = new Set((d.tags || []).map(t => String(t).toLowerCase().trim()));

    for (const other of dtus) {
      if (!other?.id || other.id === d.id) continue;
      const oTags = (other.tags || []).map(t => String(t).toLowerCase().trim());
      for (const t of oTags) {
        if (dTags.has(t)) {
          connectionCount++;
          break; // Count each connected DTU once
        }
      }
    }

    hubScores.push({
      hubId: uid("hub"),
      dtuId: d.id,
      domain: d.domain || "unknown",
      connectionCount,
      tagCount: d.tags.length,
      tier: d.tier || "unknown",
    });
  }

  // Top 20 hubs by connection count
  return hubScores
    .sort((a, b) => b.connectionCount - a.connectionCount)
    .slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate actionable recommendations from a topology map.
 * Step 5 of HLM process.
 *
 * Recommendation types:
 *   - fill_gap → suggest bridging DTU
 *   - merge_redundant → suggest MEGA
 *   - rescue_orphan → suggest cluster
 *
 * @param {Object} topology - Topology map from topologyMap()
 * @returns {{ recommendations: Object[] }}
 */
export function getRecommendations(topology) {
  try {
    if (!topology) return { recommendations: [] };

    const recommendations = [];

    // fill_gap: For each gap, suggest creating a bridging DTU
    for (const gap of (topology.gaps || [])) {
      const rec = {
        recId: uid("rec"),
        type: "fill_gap",
        priority: clamp01(0.5 + (gap.tagACount + gap.tagBCount) * 0.02),
        description: `Create bridging DTU connecting "${gap.tagA}" and "${gap.tagB}" in cluster "${gap.clusterName}"`,
        data: {
          clusterId: gap.clusterId,
          clusterName: gap.clusterName,
          tagA: gap.tagA,
          tagB: gap.tagB,
          suggestedTags: [gap.tagA, gap.tagB],
        },
        createdAt: nowISO(),
      };
      recommendations.push(rec);
      hlmRecommendations.set(rec.recId, rec);
    }

    // merge_redundant: For each redundancy, suggest MEGA merge
    for (const r of (topology.redundancies || [])) {
      const rec = {
        recId: uid("rec"),
        type: "merge_redundant",
        priority: clamp01(r.similarity),
        description: `Merge near-duplicate DTUs ${r.dtuA} and ${r.dtuB} (similarity: ${r.similarity}). Keep ${r.keepId} (higher authority).`,
        data: {
          keepId: r.keepId,
          mergeId: r.mergeId,
          similarity: r.similarity,
          keepAuthority: r.keepAuthority,
          suggestMega: r.similarity >= 0.9,
        },
        createdAt: nowISO(),
      };
      recommendations.push(rec);
      hlmRecommendations.set(rec.recId, rec);
    }

    // rescue_orphan: For each orphan with a suggested cluster, recommend placement
    for (const o of (topology.orphans || [])) {
      if (!o.suggestedCluster) continue;
      const rec = {
        recId: uid("rec"),
        type: "rescue_orphan",
        priority: clamp01(o.suggestedCluster.affinity),
        description: `Place orphan DTU ${o.dtuId} into cluster "${o.suggestedCluster.clusterName}" (affinity: ${o.suggestedCluster.affinity})`,
        data: {
          dtuId: o.dtuId,
          clusterId: o.suggestedCluster.clusterId,
          clusterName: o.suggestedCluster.clusterName,
          affinity: o.suggestedCluster.affinity,
        },
        createdAt: nowISO(),
      };
      recommendations.push(rec);
      hlmRecommendations.set(rec.recId, rec);
    }

    // Sort by priority descending
    recommendations.sort((a, b) => b.priority - a.priority);

    hlmMetricsStore.totalRecommendations += recommendations.length;

    return { recommendations };
  } catch {
    return { recommendations: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DOMAIN CENSUS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Count DTUs per domain and identify imbalances.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {{ domains: Object[], imbalances: Object[], totalDtus: number }}
 */
export function domainCensus(dtus) {
  try {
    if (!Array.isArray(dtus) || dtus.length === 0) {
      return { domains: [], imbalances: [], totalDtus: 0 };
    }

    const domainCounts = new Map();
    const domainTiers = new Map(); // domain → { tier → count }

    for (const d of dtus) {
      if (!d?.id) continue;
      const domain = d.domain || "unclassified";
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

      if (!domainTiers.has(domain)) domainTiers.set(domain, {});
      const tiers = domainTiers.get(domain);
      const tier = d.tier || "unknown";
      tiers[tier] = (tiers[tier] || 0) + 1;
    }

    const avgCount = dtus.length / Math.max(1, domainCounts.size);
    const domains = [];
    const imbalances = [];

    for (const [domain, count] of domainCounts) {
      const ratio = count / dtus.length;
      const entry = {
        domain,
        count,
        ratio: Math.round(ratio * 1000) / 1000,
        tiers: domainTiers.get(domain) || {},
      };
      domains.push(entry);

      // Flag if domain is significantly over- or under-represented
      if (count > avgCount * 3) {
        imbalances.push({
          domain,
          type: "over_represented",
          count,
          average: Math.round(avgCount),
          ratio: Math.round((count / avgCount) * 100) / 100,
          description: `Domain "${domain}" has ${count} DTUs (${Math.round(ratio * 100)}%), significantly above average`,
        });
      } else if (count < avgCount * 0.2 && domainCounts.size > 3) {
        imbalances.push({
          domain,
          type: "under_represented",
          count,
          average: Math.round(avgCount),
          ratio: Math.round((count / avgCount) * 100) / 100,
          description: `Domain "${domain}" has only ${count} DTUs, significantly below average`,
        });
      }
    }

    domains.sort((a, b) => b.count - a.count);

    return { domains, imbalances, totalDtus: dtus.length };
  } catch {
    return { domains: [], imbalances: [], totalDtus: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FRESHNESS CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identify stale DTUs that haven't been updated in STALE_DAYS.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {{ stale: Object[], fresh: number, staleCount: number }}
 */
export function freshnessCheck(dtus) {
  try {
    if (!Array.isArray(dtus) || dtus.length === 0) {
      return { stale: [], fresh: 0, staleCount: 0 };
    }

    const now = Date.now();
    const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;
    const stale = [];
    let fresh = 0;

    for (const d of dtus) {
      if (!d?.id) continue;

      const createdAt = d.createdAt ? new Date(d.createdAt).getTime() : 0;
      const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);

      if (ageDays > STALE_DAYS) {
        stale.push({
          dtuId: d.id,
          domain: d.domain || "unknown",
          tier: d.tier || "unknown",
          ageDays: Math.round(ageDays),
          createdAt: d.createdAt || null,
          authority: d.authority?.score || 0,
          tags: d.tags || [],
        });
      } else {
        fresh++;
      }
    }

    // Sort by age descending (oldest first)
    stale.sort((a, b) => b.ageDays - a.ageDays);

    return { stale, fresh, staleCount: stale.length };
  } catch {
    return { stale: [], fresh: 0, staleCount: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. HIERARCHY CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verify MEGA/HYPER promotions are appropriate.
 * A MEGA should have high authority and multiple children.
 * A HYPER should have even higher authority and broad domain span.
 *
 * @param {Object[]} dtus
 * @returns {{ issues: Object[] }}
 */
function hierarchyCheck(dtus) {
  try {
    if (!Array.isArray(dtus)) return { issues: [] };

    const dtuMap = new Map();
    const childCounts = new Map(); // parentId → count
    for (const d of dtus) {
      if (!d?.id) continue;
      dtuMap.set(d.id, d);
      if (d.parentId) {
        childCounts.set(d.parentId, (childCounts.get(d.parentId) || 0) + 1);
      }
    }

    const issues = [];

    for (const d of dtus) {
      if (!d?.id) continue;
      const tier = String(d.tier || "").toLowerCase();
      const authority = d.authority?.score || 0;
      const children = childCounts.get(d.id) || 0;

      if (tier === "mega") {
        if (authority < 0.5) {
          issues.push({
            dtuId: d.id,
            tier: "MEGA",
            issue: "low_authority",
            authority,
            description: `MEGA DTU ${d.id} has low authority (${authority}), may not warrant promotion`,
          });
        }
        if (children < 2) {
          issues.push({
            dtuId: d.id,
            tier: "MEGA",
            issue: "few_children",
            children,
            description: `MEGA DTU ${d.id} has only ${children} children, MEGAs should aggregate multiple DTUs`,
          });
        }
      }

      if (tier === "hyper") {
        if (authority < 0.7) {
          issues.push({
            dtuId: d.id,
            tier: "HYPER",
            issue: "low_authority",
            authority,
            description: `HYPER DTU ${d.id} has low authority (${authority}), may not warrant HYPER status`,
          });
        }
        if (children < 3) {
          issues.push({
            dtuId: d.id,
            tier: "HYPER",
            issue: "few_children",
            children,
            description: `HYPER DTU ${d.id} has only ${children} children, HYPERs should span broadly`,
          });
        }
      }
    }

    return { issues };
  } catch {
    return { issues: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. TAG NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Standardize tags across DTUs.
 * Detects near-duplicate tags (e.g., "machine_learning" vs "machine-learning")
 * and suggests normalization.
 *
 * @param {Object[]} dtus
 * @returns {{ normalizations: Object[], tagCounts: Object }}
 */
function tagNormalization(dtus) {
  try {
    if (!Array.isArray(dtus)) return { normalizations: [], tagCounts: {} };

    const tagCounts = new Map(); // normalized tag → count
    const tagVariants = new Map(); // canonical → Set<original>

    for (const d of dtus) {
      if (!d?.id || !Array.isArray(d.tags)) continue;
      for (const t of d.tags) {
        const raw = String(t).trim();
        const norm = raw.toLowerCase().replace(/[\s_-]+/g, "_");
        tagCounts.set(norm, (tagCounts.get(norm) || 0) + 1);
        if (!tagVariants.has(norm)) tagVariants.set(norm, new Set());
        tagVariants.get(norm).add(raw);
      }
    }

    const normalizations = [];
    for (const [norm, variants] of tagVariants) {
      if (variants.size > 1) {
        normalizations.push({
          canonical: norm,
          variants: Array.from(variants),
          count: tagCounts.get(norm) || 0,
          description: `Tag "${norm}" has ${variants.size} variants: ${Array.from(variants).join(", ")}`,
        });
      }
    }

    const tagCountsObj = {};
    for (const [tag, count] of tagCounts) {
      tagCountsObj[tag] = count;
    }

    return { normalizations, tagCounts: tagCountsObj };
  } catch {
    return { normalizations: [], tagCounts: {} };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. LINEAGE AUDIT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verify parent-child relationships are valid.
 *
 * @param {Object[]} dtus
 * @returns {{ issues: Object[] }}
 */
function lineageAudit(dtus) {
  try {
    if (!Array.isArray(dtus)) return { issues: [] };

    const dtuMap = new Map();
    for (const d of dtus) {
      if (d?.id) dtuMap.set(d.id, d);
    }

    const issues = [];

    for (const d of dtus) {
      if (!d?.id) continue;

      // Check for broken parent references
      if (d.parentId && !dtuMap.has(d.parentId)) {
        issues.push({
          dtuId: d.id,
          issue: "broken_parent",
          parentId: d.parentId,
          description: `DTU ${d.id} references parent ${d.parentId} which does not exist`,
        });
      }

      // Check for self-referencing
      if (d.parentId && d.parentId === d.id) {
        issues.push({
          dtuId: d.id,
          issue: "self_parent",
          description: `DTU ${d.id} references itself as parent`,
        });
      }
    }

    // Check for cycles (A → B → A)
    for (const d of dtus) {
      if (!d?.id || !d.parentId) continue;
      const visited = new Set();
      let current = d.id;
      let hasCycle = false;

      while (current) {
        if (visited.has(current)) {
          hasCycle = true;
          break;
        }
        visited.add(current);
        const dtu = dtuMap.get(current);
        current = dtu?.parentId || null;
      }

      if (hasCycle) {
        issues.push({
          dtuId: d.id,
          issue: "lineage_cycle",
          description: `DTU ${d.id} is part of a parent-child cycle`,
        });
      }
    }

    return { issues };
  } catch {
    return { issues: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. FULL HLM PASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run a full HLM pass on the given DTU set.
 * Executes all analysis steps and produces a complete topology
 * with recommendations.
 *
 * @param {Object[]} dtus - Array of DTU objects
 * @returns {Object} Full HLM pass result
 */
export function runHLMPass(dtus) {
  try {
    if (!Array.isArray(dtus)) {
      return { ok: false, error: "dtus_must_be_array" };
    }

    const passId = uid("hlm");
    const startedAt = nowISO();

    // Step 1: Cluster analysis
    const clusterResult = clusterAnalysis(dtus);

    // Step 2: Gap analysis per cluster
    const gapResult = gapAnalysis(clusterResult.clusters, dtus);

    // Step 3: Redundancy detection
    const redundancyResult = redundancyDetection(dtus);

    // Step 4: Topology map
    const topology = topologyMap(dtus);

    // Step 5: Recommendations
    const recResult = getRecommendations(topology);

    // Additional analyses
    const orphanResult = orphanRescue(dtus, clusterResult.clusters);
    const censusResult = domainCensus(dtus);
    const freshResult = freshnessCheck(dtus);
    const hierarchyResult = hierarchyCheck(dtus);
    const tagResult = tagNormalization(dtus);
    const lineageResult = lineageAudit(dtus);

    const pass = {
      passId,
      ok: true,
      startedAt,
      completedAt: nowISO(),
      topology,
      clusters: clusterResult,
      gaps: gapResult,
      redundancies: redundancyResult,
      orphans: orphanResult,
      recommendations: recResult,
      domainCensus: censusResult,
      freshness: freshResult,
      hierarchy: hierarchyResult,
      tagNormalization: tagResult,
      lineage: lineageResult,
      summary: {
        totalDtus: dtus.length,
        clusterCount: clusterResult.clusters.length,
        unassignedCount: clusterResult.unassigned.length,
        gapCount: gapResult.gaps.length,
        redundancyCount: redundancyResult.redundancies.length,
        orphanCount: orphanResult.orphans.length,
        recommendationCount: recResult.recommendations.length,
        staleDtuCount: freshResult.staleCount,
        hierarchyIssues: hierarchyResult.issues.length,
        tagNormalizationIssues: tagResult.normalizations.length,
        lineageIssues: lineageResult.issues.length,
        domainImbalances: censusResult.imbalances.length,
      },
    };

    // Store the pass
    hlmPasses.set(passId, pass);
    if (hlmPasses.size > 100) {
      const oldest = Array.from(hlmPasses.keys()).slice(0, hlmPasses.size - 50);
      for (const k of oldest) hlmPasses.delete(k);
    }

    // Update metrics
    hlmMetricsStore.totalPasses++;
    hlmMetricsStore.totalClusters += clusterResult.clusters.length;
    hlmMetricsStore.totalOrphans += orphanResult.orphans.length;
    hlmMetricsStore.totalRedundancies += redundancyResult.redundancies.length;
    hlmMetricsStore.totalGaps += gapResult.gaps.length;
    hlmMetricsStore.lastPassAt = pass.completedAt;
    hlmMetricsStore.lastPassId = passId;

    return pass;
  } catch {
    return { ok: false, error: "hlm_pass_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get HLM engine metrics.
 *
 * @returns {Object} Metrics summary
 */
export function getHLMMetrics() {
  return {
    ok: true,
    ...hlmMetricsStore,
    storedPasses: hlmPasses.size,
    storedRecommendations: hlmRecommendations.size,
  };
}
