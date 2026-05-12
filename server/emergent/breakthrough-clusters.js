/**
 * System 10: Breakthrough DTU Clusters
 *
 * Pre-structured DTU clusters for breakthrough ideas. Each cluster defines
 * a domain of investigation with seed DTUs, hypotheses, and research tracking.
 *
 * Three initial clusters:
 *   1. USB (Universal Structural Block) — materials science
 *   2. Lava Energy (Geothermal/Lava Energy Systems) — energy
 *   3. 20-Year Plan & Microbond Governance — governance
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

// ── In-Memory State ─────────────────────────────────────────────────────────

/** clusterId -> { ...clusterDef, dtus: Map<dtuId, DTU>, initialized: bool, researchJobs: [] } */
const clusters = new LruMap();

/** dtuId -> DTU (flat index across all clusters) */
const allDTUs = new LruMap();

/** researchJobId -> { id, clusterId, status, startedAt, completedAt } */
const researchJobs = new LruMap();

// ── Cluster Definitions ─────────────────────────────────────────────────────

export const BREAKTHROUGH_CLUSTERS = Object.freeze({
  usb: {
    id: "usb",
    name: "Universal Structural Block",
    domain: "materials_science",
    description: "Modular, printable, recyclable construction block.",
    seedTopics: [
      { topic: "Material composition", tags: ["composite", "polymer", "recyclable"] },
      { topic: "Interlocking geometry", tags: ["modular", "geometry", "snap-fit"] },
      { topic: "Thermal properties", tags: ["insulation", "thermal", "conductivity"] },
      { topic: "Structural load analysis", tags: ["load-bearing", "stress", "engineering"] },
      { topic: "Manufacturing process (3D printing)", tags: ["3d-printing", "additive-manufacturing", "scalable"] },
      { topic: "Smart city applications", tags: ["smart-city", "infrastructure", "urban-planning"] },
      { topic: "Underwater construction", tags: ["marine", "underwater", "pressure-resistant"] },
      { topic: "Space habitat applications", tags: ["space", "habitat", "low-gravity"] },
      { topic: "Recycling lifecycle", tags: ["recycling", "circular-economy", "sustainability"] },
      { topic: "Cost analysis vs traditional", tags: ["cost", "economics", "comparison"] },
    ],
    hypotheses: [
      "95%+ recyclability while maintaining structural integrity",
      "60% build time reduction vs traditional",
      "Thermal properties eliminate separate insulation needs in moderate climates",
    ],
  },

  lava_energy: {
    id: "lava_energy",
    name: "Geothermal/Lava Energy Systems",
    domain: "energy",
    description: "Advanced geothermal tunnels, extreme-environment materials.",
    seedTopics: [
      { topic: "Deep tunnel engineering", tags: ["tunneling", "deep-earth", "boring"] },
      { topic: "Extreme heat materials", tags: ["refractory", "high-temp", "ceramics"] },
      { topic: "Magma proximity power generation", tags: ["magma", "power-gen", "heat-exchange"] },
      { topic: "Grid integration", tags: ["grid", "baseload", "transmission"] },
      { topic: "Safety protocols", tags: ["safety", "hazard", "emergency-systems"] },
      { topic: "Cost comparison", tags: ["cost", "economics", "nuclear-comparison"] },
      { topic: "Environmental impact", tags: ["environmental", "emissions", "ecological"] },
    ],
    hypotheses: [
      "5km depth geothermal cheaper than nuclear baseload",
      "USB-derived materials withstand temps within 100m of magma",
    ],
  },

  twenty_year_plan: {
    id: "twenty_year_plan",
    name: "20-Year Plan & Microbond Governance",
    domain: "governance",
    description: "Citizen-driven multi-layered governance for middle-class uplift.",
    seedTopics: [
      { topic: "Microbond voting mechanics", tags: ["microbond", "voting", "democratic-finance"] },
      { topic: "Spillover fund redistribution", tags: ["spillover", "redistribution", "equity"] },
      { topic: "Multi-layer governance coordination", tags: ["multi-layer", "coordination", "federalism"] },
      { topic: "Middle-class uplift economic modeling", tags: ["middle-class", "uplift", "economic-model"] },
      { topic: "20-year infrastructure investment returns", tags: ["infrastructure", "long-term", "roi"] },
      { topic: "Anti-capture safeguards", tags: ["anti-capture", "corruption", "safeguards"] },
    ],
    hypotheses: [],
  },
});

// ── Seed DTU Creation ───────────────────────────────────────────────────────

/**
 * Create a single seed DTU for a cluster.
 *
 * @param {string} clusterId
 * @param {string} topic
 * @param {string[]} seedTags
 * @param {object} cluster - Cluster definition
 * @returns {object} The created DTU
 */
function createSeedDTU(clusterId, topic, seedTags, cluster) {
  const dtu = {
    id: uid("dtu"),
    type: "knowledge",
    title: topic,
    human: { summary: `Seed DTU for ${cluster.name}: ${topic}` },
    machine: { kind: "breakthrough_seed", clusterId, clusterName: cluster.name },
    source: "breakthrough_cluster",
    authority: { model: "seed", score: 0.3 },
    tier: "shadow",
    scope: "local",
    tags: [...seedTags, "breakthrough", clusterId],
    domain: cluster.domain,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return dtu;
}

// ── Cluster Operations ──────────────────────────────────────────────────────

/**
 * Initialize a breakthrough cluster by generating its seed DTUs.
 * Idempotent — returns existing cluster if already initialized.
 *
 * @param {string} clusterId - One of: "usb", "lava_energy", "twenty_year_plan"
 * @returns {{ ok: boolean, clusterId?: string, dtusCreated?: number, error?: string }}
 */
export function initCluster(clusterId) {
  try {
    const def = BREAKTHROUGH_CLUSTERS[clusterId];
    if (!def) {
      return { ok: false, error: "unknown_cluster", clusterId };
    }

    // Already initialized
    if (clusters.has(clusterId)) {
      const existing = clusters.get(clusterId);
      return {
        ok: true,
        clusterId,
        dtusCreated: 0,
        alreadyInitialized: true,
        totalDTUs: existing.dtus.size,
      };
    }

    const clusterState = {
      id: def.id,
      name: def.name,
      domain: def.domain,
      description: def.description,
      hypotheses: [...def.hypotheses],
      dtus: new Map(),
      initialized: true,
      initializedAt: nowISO(),
      researchJobs: [],
    };

    // Generate seed DTUs
    for (const seed of def.seedTopics) {
      const dtu = createSeedDTU(clusterId, seed.topic, seed.tags, def);
      clusterState.dtus.set(dtu.id, dtu);
      allDTUs.set(dtu.id, dtu);
    }

    clusters.set(clusterId, clusterState);

    return {
      ok: true,
      clusterId,
      dtusCreated: clusterState.dtus.size,
      totalDTUs: clusterState.dtus.size,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Get the status of a breakthrough cluster.
 *
 * @param {string} clusterId
 * @returns {{ ok: boolean, status?: object, error?: string }}
 */
export function getClusterStatus(clusterId) {
  try {
    const def = BREAKTHROUGH_CLUSTERS[clusterId];
    if (!def) {
      return { ok: false, error: "unknown_cluster", clusterId };
    }

    const state = clusters.get(clusterId);
    if (!state) {
      return {
        ok: true,
        status: {
          clusterId,
          name: def.name,
          domain: def.domain,
          initialized: false,
          totalSeedTopics: def.seedTopics.length,
          totalDTUs: 0,
          hypotheses: def.hypotheses,
          researchJobs: [],
        },
      };
    }

    const dtuList = Array.from(state.dtus.values());
    const seedCount = dtuList.filter(d => d.machine?.kind === "breakthrough_seed").length;
    const customCount = dtuList.length - seedCount;

    return {
      ok: true,
      status: {
        clusterId,
        name: state.name,
        domain: state.domain,
        initialized: state.initialized,
        initializedAt: state.initializedAt,
        totalDTUs: state.dtus.size,
        seedDTUs: seedCount,
        customDTUs: customCount,
        hypotheses: state.hypotheses,
        researchJobs: state.researchJobs.map(id => {
          const job = researchJobs.get(id);
          return job || { id, status: "unknown" };
        }),
      },
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Trigger a research job for a cluster. Creates a trackable job record.
 *
 * @param {string} clusterId
 * @returns {{ ok: boolean, jobId?: string, error?: string }}
 */
export function triggerClusterResearch(clusterId) {
  try {
    const def = BREAKTHROUGH_CLUSTERS[clusterId];
    if (!def) {
      return { ok: false, error: "unknown_cluster", clusterId };
    }

    // Auto-initialize if not yet initialized
    if (!clusters.has(clusterId)) {
      const initResult = initCluster(clusterId);
      if (!initResult.ok) return initResult;
    }

    const state = clusters.get(clusterId);
    const jobId = uid("research");

    const job = {
      id: jobId,
      clusterId,
      clusterName: state.name,
      domain: state.domain,
      status: "running",
      dtuCount: state.dtus.size,
      hypotheses: [...state.hypotheses],
      startedAt: nowISO(),
      completedAt: null,
      results: null,
    };

    researchJobs.set(jobId, job);
    state.researchJobs.push(jobId);

    return {
      ok: true,
      jobId,
      clusterId,
      status: "running",
      dtuCount: job.dtuCount,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * List all breakthrough clusters with their initialization status.
 *
 * @returns {{ ok: boolean, clusters: object[] }}
 */
export function listClusters() {
  try {
    const result = [];

    for (const [id, def] of Object.entries(BREAKTHROUGH_CLUSTERS)) {
      const state = clusters.get(id);
      result.push({
        clusterId: id,
        name: def.name,
        domain: def.domain,
        description: def.description,
        initialized: !!state,
        totalSeedTopics: def.seedTopics.length,
        totalDTUs: state ? state.dtus.size : 0,
        hypothesesCount: def.hypotheses.length,
      });
    }

    return { ok: true, clusters: result, count: result.length };
  } catch (e) {
    return { ok: false, clusters: [], error: String(e?.message || e) };
  }
}

/**
 * Get all DTUs belonging to a cluster.
 *
 * @param {string} clusterId
 * @returns {{ ok: boolean, dtus?: object[], error?: string }}
 */
export function getClusterDTUs(clusterId) {
  try {
    const def = BREAKTHROUGH_CLUSTERS[clusterId];
    if (!def) {
      return { ok: false, error: "unknown_cluster", clusterId };
    }

    const state = clusters.get(clusterId);
    if (!state) {
      return { ok: true, dtus: [], count: 0, initialized: false };
    }

    const dtus = Array.from(state.dtus.values());
    return { ok: true, dtus, count: dtus.length, initialized: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Add a custom seed DTU to a cluster.
 *
 * @param {string} clusterId
 * @param {string} topic - Title / topic for the DTU
 * @param {string[]} [tags=[]] - Additional tags
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function addSeedDTU(clusterId, topic, tags = []) {
  try {
    const def = BREAKTHROUGH_CLUSTERS[clusterId];
    if (!def) {
      return { ok: false, error: "unknown_cluster", clusterId };
    }

    if (!topic || typeof topic !== "string") {
      return { ok: false, error: "topic_required" };
    }

    // Auto-initialize if not yet initialized
    if (!clusters.has(clusterId)) {
      const initResult = initCluster(clusterId);
      if (!initResult.ok) return initResult;
    }

    const state = clusters.get(clusterId);
    const seedTags = Array.isArray(tags) ? tags : [];
    const dtu = createSeedDTU(clusterId, topic, seedTags, def);

    state.dtus.set(dtu.id, dtu);
    allDTUs.set(dtu.id, dtu);

    return { ok: true, dtu, clusterId, totalDTUs: state.dtus.size };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Get aggregate metrics across all breakthrough clusters.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getBreakthroughMetrics() {
  try {
    const clusterCount = Object.keys(BREAKTHROUGH_CLUSTERS).length;
    const initializedCount = clusters.size;
    const totalDTUs = allDTUs.size;

    let totalResearchJobs = 0;
    let runningJobs = 0;
    let completedJobs = 0;
    let totalHypotheses = 0;

    for (const job of researchJobs.values()) {
      totalResearchJobs++;
      if (job.status === "running") runningJobs++;
      if (job.status === "completed") completedJobs++;
    }

    for (const def of Object.values(BREAKTHROUGH_CLUSTERS)) {
      totalHypotheses += def.hypotheses.length;
    }

    const perCluster = {};
    for (const [id, def] of Object.entries(BREAKTHROUGH_CLUSTERS)) {
      const state = clusters.get(id);
      perCluster[id] = {
        name: def.name,
        domain: def.domain,
        initialized: !!state,
        dtuCount: state ? state.dtus.size : 0,
        researchJobCount: state ? state.researchJobs.length : 0,
        hypothesesCount: def.hypotheses.length,
      };
    }

    return {
      ok: true,
      metrics: {
        clusterCount,
        initializedCount,
        totalDTUs,
        totalResearchJobs,
        runningJobs,
        completedJobs,
        totalHypotheses,
        perCluster,
      },
    };
  } catch (e) {
    return { ok: false, metrics: {}, error: String(e?.message || e) };
  }
}
