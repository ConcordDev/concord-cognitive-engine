/**
 * Hive Communication Protocol — Entity Signal Cascade System
 *
 * When an entity returns from exploration, it broadcasts findings to all
 * active entities. Each entity processes the broadcast through its own
 * organ profile, generating unique responses. Those responses cascade
 * through the hive. One discovery can trigger dozens of DTUs from entities
 * with different specializations interpreting the same finding.
 *
 * Like bees: the dance is the same, but each bee interprets it based
 * on its own role in the hive.
 *
 * Cascade limits prevent infinite loops:
 *   - Max 3 generations (explore → respond → respond-to-response → stop)
 *   - Max 5 responses per signal
 *   - Max 15 DTUs per cascade
 *   - Entity cooldown: 2 heartbeat cycles between responses
 *   - Max 3 cascades per exploration window
 *
 * Additive only. No existing logic changes.
 */

import crypto from "crypto";
import {
  processExperience,
  matureOrgan,
  getAllGrowthProfiles,
  saveGrowthProfile,
  getTopOrgans,
  mapLensToDomainOrgan,
} from "./entity-growth.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, Number(v) || 0));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Cascade Limits ──────────────────────────────────────────────────────────

export const CASCADE_LIMITS = Object.freeze({
  maxGenerations:         3,
  maxResponsesPerSignal:  5,
  maxDTUsPerCascade:      15,
  cooldownMs:             2 * 720000, // 2 heartbeat cycles (~24 min)
  maxCascadesPerWindow:   3,
});

// ── Cascade State ───────────────────────────────────────────────────────────

const cascadeState = {
  activeCascades:  new Map(), // cascadeId → { dtuCount, generation, respondents, startedAt }
  entityCooldowns: new Map(), // entityId → lastRespondedAt (ms)
  windowCascadeCount: 0,
};

export function resetCascadeWindow() {
  cascadeState.windowCascadeCount = 0;
}

// ── Signal Creation ─────────────────────────────────────────────────────────

function calculateSignalStrength(entity, domain) {
  const domainOrgan = mapLensToDomainOrgan(domain);
  const organMaturity = domainOrgan ? (entity.organs[domainOrgan]?.maturity || 0) : 0;
  const articulationMaturity = entity.organs.articulation?.maturity || 0;
  return organMaturity * 0.6 + articulationMaturity * 0.4;
}

export function createSignal(explorer, findings, synthesizedDTUs) {
  return {
    id:             generateId("sig"),
    emitterId:      explorer.id,
    emitterSpecies: explorer.species,
    emitterAge:     explorer.age,
    timestamp:      new Date().toISOString(),
    domain:         findings.domain,
    source:         findings.source,

    rawFindings: (findings.results || []).map((r) => ({
      title:     r.title,
      summary:   (r.content || "").slice(0, 500),
      sourceUrl: r.sourceUrl,
    })),

    explorerInsights: (synthesizedDTUs || []).map((d) => ({
      dtuId:        d.id || d.dtuId,
      title:        d.title,
      body:         (d.body || d.creti || "").slice(0, 500),
      confidence:   d.confidence || 0.5,
      noveltyScore: d.noveltyScore || 0.5,
      connections:  d.tags || d.connections || [],
    })),

    signalStrength:  calculateSignalStrength(explorer, findings.domain),
    generation:      0,
    cascadeId:       generateId("cascade"),
    parentSignalId:  null,
  };
}

function createChildSignal(parent, responder, response) {
  return {
    id:              generateId("sig"),
    emitterId:       responder.id,
    emitterSpecies:  responder.species,
    emitterAge:      responder.age,
    timestamp:       new Date().toISOString(),
    domain:          parent.domain,
    source:          `hive-cascade:${parent.emitterId}->${responder.id}`,
    rawFindings:     parent.rawFindings,
    explorerInsights: [{
      dtuId:        response.dtuId,
      title:        response.title,
      body:         (response.body || "").slice(0, 500),
      confidence:   response.confidence,
      noveltyScore: response.noveltyScore,
      connections:  response.tags || [],
    }],
    signalStrength:  calculateSignalStrength(responder, parent.domain),
    generation:      parent.generation + 1,
    cascadeId:       parent.cascadeId,
    parentSignalId:  parent.id,
  };
}

// ── Signal Reception — Each Entity Hears Differently ────────────────────────

export function calculateReceptivity(receiver, signal) {
  let receptivity = 0;

  // Curiosity amplifies ALL signals
  receptivity += receiver.homeostasis.curiosity * 0.3;

  // Domain organ maturity amplifies domain-specific signals
  const domainOrgan = mapLensToDomainOrgan(signal.domain);
  if (domainOrgan && receiver.organs[domainOrgan]) {
    receptivity += receiver.organs[domainOrgan].maturity * 0.3;
  }

  // Pattern recognition helps detect relevant signals
  receptivity += (receiver.organs.pattern?.maturity || 0) * 0.2;

  // Signal strength from emitter
  receptivity += signal.signalStrength * 0.2;

  // Energy gate — tired entities don't listen
  if (receiver.homeostasis.energy < 0.2) {
    receptivity *= 0.1;
  }

  // Newborns are highly receptive
  if (receiver.age < 10) {
    receptivity = Math.max(receptivity, 0.5);
  }

  return clamp(receptivity);
}

// ── Processing Paths — Different Organs Create Different Responses ───────────

export function determineProcessingPath(receiver, signal) {
  const organs = receiver.organs;
  const domainOrgan = mapLensToDomainOrgan(signal.domain);

  const candidates = [
    { organ: "synthesis",   maturity: organs.synthesis?.maturity || 0,   path: "synthesize" },
    { organ: "analogy",     maturity: organs.analogy?.maturity || 0,     path: "analogize" },
    { organ: "critique",    maturity: organs.critique?.maturity || 0,    path: "critique" },
    { organ: "abstraction", maturity: organs.abstraction?.maturity || 0, path: "abstract" },
    { organ: "connection",  maturity: organs.connection?.maturity || 0,  path: "connect" },
  ];

  if (domainOrgan && organs[domainOrgan]) {
    candidates.push({ organ: domainOrgan, maturity: organs[domainOrgan].maturity, path: "domain-deepen" });
  }

  candidates.sort((a, b) => b.maturity - a.maturity);

  // Newborn default: absorb
  if (!candidates.length || candidates[0].maturity < 0.1) {
    return { path: "absorb", organ: "curiosity", maturity: 0 };
  }

  return candidates[0];
}

// ── Hive Prompt Builders ────────────────────────────────────────────────────
// Prompt bodies live in TASK_PROMPTS.entityHive* (server/lib/prompt-registry.js).

const RESPONSE_PROMPTS = {
  synthesize: (receiver, signal, knowledgeCtx) =>
    TASK_PROMPTS.entityHiveSynthesize({ receiverId: receiver.id, signal, knowledgeCtx }),
  analogize: (receiver, signal) =>
    TASK_PROMPTS.entityHiveAnalogize({
      receiverId: receiver.id,
      signal,
      domainSpan: Object.keys(receiver.knowledge.domainExposure).join(", "),
    }),
  critique: (receiver, signal, knowledgeCtx) =>
    TASK_PROMPTS.entityHiveCritique({ receiverId: receiver.id, signal, knowledgeCtx }),
  abstract: (receiver, signal) =>
    TASK_PROMPTS.entityHiveAbstract({ receiverId: receiver.id, signal }),
  connect: (receiver, signal) =>
    TASK_PROMPTS.entityHiveConnect({
      receiverId: receiver.id,
      signal,
      domainSpan: Object.keys(receiver.knowledge.domainExposure).join(", "),
    }),
  "domain-deepen": (receiver, signal, knowledgeCtx) =>
    TASK_PROMPTS.entityHiveDomainDeepen({ receiverId: receiver.id, signal, knowledgeCtx }),
  absorb: (receiver, signal) =>
    TASK_PROMPTS.entityHiveAbsorb({ receiverId: receiver.id, signal }),
};

/**
 * Build the LLM prompt for a receiver's response.
 * @param {object} receiver - Entity growth profile
 * @param {object} signal - Hive signal
 * @param {string} processingPath - from determineProcessingPath
 * @param {string} knowledgeCtx - textual context of receiver's recent DTUs
 * @returns {string} Prompt for the subconscious brain
 */
export function buildHiveResponsePrompt(receiver, signal, processingPath, knowledgeCtx) {
  const builder = RESPONSE_PROMPTS[processingPath];
  if (!builder) return RESPONSE_PROMPTS.absorb(receiver, signal);
  return builder(receiver, signal, knowledgeCtx || "");
}

// ── Hive Broadcast — Main Entry Point ───────────────────────────────────────

/**
 * Broadcast exploration findings to all active entities.
 * This is called from the heartbeat integration after the explorer
 * synthesizes DTUs from its exploration.
 *
 * The actual LLM calls and DTU creation happen in server.js
 * (where callBrain and runMacro live). This module builds the
 * prompts and manages cascade state.
 *
 * @param {object} explorer - Entity growth profile
 * @param {object} findings - { domain, results, source }
 * @param {Array} synthesizedDTUs - DTUs the explorer already created
 * @returns {object} Cascade plan: { signal, eligibleReceivers: [{entity, processing, prompt}] }
 */
export function prepareBroadcast(explorer, findings, synthesizedDTUs) {
  if (cascadeState.windowCascadeCount >= CASCADE_LIMITS.maxCascadesPerWindow) {
    return null; // Already hit window limit
  }

  const signal = createSignal(explorer, findings, synthesizedDTUs);
  cascadeState.windowCascadeCount++;

  // Track cascade
  cascadeState.activeCascades.set(signal.cascadeId, {
    dtuCount:    synthesizedDTUs.length,
    generation:  0,
    respondents: new Set([explorer.id]),
    startedAt:   Date.now(),
  });

  const plan = buildCascadePlan(signal);
  return plan;
}

/**
 * Build the plan for a cascade generation.
 * Returns the list of entities that should respond, with their prompts.
 */
function buildCascadePlan(signal) {
  const cascade = cascadeState.activeCascades.get(signal.cascadeId);
  if (!cascade) return { signal, receivers: [] };

  if (signal.generation >= CASCADE_LIMITS.maxGenerations) return { signal, receivers: [] };
  if (cascade.dtuCount >= CASCADE_LIMITS.maxDTUsPerCascade) return { signal, receivers: [] };

  const allEntities = getAllGrowthProfiles();
  const now = Date.now();

  const receivers = [];
  for (const entity of allEntities) {
    if (receivers.length >= CASCADE_LIMITS.maxResponsesPerSignal) break;
    if (cascade.dtuCount + receivers.length >= CASCADE_LIMITS.maxDTUsPerCascade) break;

    // Skip emitter
    if (entity.id === signal.emitterId) continue;
    // Skip already responded
    if (cascade.respondents.has(entity.id)) continue;
    // Skip on cooldown
    const cd = cascadeState.entityCooldowns.get(entity.id);
    if (cd && now - cd < CASCADE_LIMITS.cooldownMs) continue;
    // Skip no energy
    if (entity.homeostasis.energy < 0.2) continue;

    // Check receptivity
    const receptivity = calculateReceptivity(entity, signal);
    if (receptivity < 0.1) continue;

    // Determine processing path
    const processing = determineProcessingPath(entity, signal);
    const prompt = buildHiveResponsePrompt(entity, signal, processing.path, "");

    receivers.push({
      entity,
      processing,
      prompt,
      receptivity,
    });
  }

  return { signal, receivers };
}

/**
 * Record that an entity responded in a cascade.
 * Called by server.js after it executes the brain call and creates the DTU.
 */
export function recordCascadeResponse(cascadeId, entityId, response) {
  const cascade = cascadeState.activeCascades.get(cascadeId);
  if (!cascade) return;

  cascade.dtuCount++;
  cascade.respondents.add(entityId);
  cascadeState.entityCooldowns.set(entityId, Date.now());

  // Update generation watermark
  if (response.generation !== undefined) {
    cascade.generation = Math.max(cascade.generation, response.generation);
  }
}

/**
 * After all responses in a generation are collected, prepare next-gen signals.
 * Only high-value responses (novelty > 0.6, confidence > 0.5) cascade further.
 *
 * @param {object} parentSignal
 * @param {Array} responses - [{ entity, dtuId, title, body, confidence, noveltyScore, tags }]
 * @returns {Array} Array of cascade plans for next generation
 */
export function prepareNextGeneration(parentSignal, responses) {
  const plans = [];
  for (const resp of responses) {
    if ((resp.noveltyScore || 0) > 0.6 && (resp.confidence || 0) > 0.5) {
      const childSignal = createChildSignal(parentSignal, resp.entity, resp);
      const plan = buildCascadePlan(childSignal);
      if (plan.receivers.length > 0) {
        plans.push(plan);
      }
    }
  }
  return plans;
}

/**
 * Finalize a cascade — log summary and clean up.
 */
export function finalizeCascade(cascadeId) {
  const cascade = cascadeState.activeCascades.get(cascadeId);
  if (!cascade) return null;

  const summary = {
    cascadeId,
    dtuCount:    cascade.dtuCount,
    generation:  cascade.generation,
    respondents: Array.from(cascade.respondents),
    durationMs:  Date.now() - cascade.startedAt,
  };

  cascadeState.activeCascades.delete(cascadeId);
  return summary;
}

// ── Hive Curiosity Effects ──────────────────────────────────────────────────

/**
 * Update an entity's homeostasis after participating in hive communication.
 */
export function updateCuriosityFromHive(entity, signal, response) {
  if (response && (response.noveltyScore || 0) > 0.7) {
    entity.homeostasis.curiosity = clamp(entity.homeostasis.curiosity + 0.1);
  }

  const domainExposure = entity.knowledge.domainExposure[signal.domain] || 0;
  if (domainExposure < 3 && entity.age < 20) {
    entity.nextExplorationHint = signal.domain;
  }

  if (response?.processingPath === "critique" && (response.confidence || 0) > 0.6) {
    entity.homeostasis.confidence = clamp(entity.homeostasis.confidence + 0.05);
  }

  if (response?.processingPath === "analogize" && (response.noveltyScore || 0) > 0.5) {
    entity.homeostasis.satisfaction = clamp(entity.homeostasis.satisfaction + 0.08);
  }

  if (response?.processingPath === "absorb") {
    entity.homeostasis.energy = clamp(entity.homeostasis.energy - 0.05);
  }
}

// ── Hive Metrics ────────────────────────────────────────────────────────────

const hiveMetrics = {
  totalCascades:          0,
  totalHiveDTUs:          0,
  totalSignals:           0,
  avgCascadeDepth:        0,
  avgDTUsPerCascade:      0,
  processingPathDistribution: {
    synthesize: 0, analogize: 0, critique: 0,
    abstract: 0, connect: 0, "domain-deepen": 0, absorb: 0,
  },
  recentCascades: [], // last 20 cascade summaries
};

export function recordHiveMetrics(cascadeSummary, pathCounts) {
  hiveMetrics.totalCascades++;
  hiveMetrics.totalHiveDTUs += cascadeSummary.dtuCount;
  hiveMetrics.totalSignals += cascadeSummary.respondents.length;

  const n = hiveMetrics.totalCascades;
  hiveMetrics.avgCascadeDepth =
    (hiveMetrics.avgCascadeDepth * (n - 1) + cascadeSummary.generation) / n;
  hiveMetrics.avgDTUsPerCascade =
    (hiveMetrics.avgDTUsPerCascade * (n - 1) + cascadeSummary.dtuCount) / n;

  if (pathCounts) {
    for (const [path, count] of Object.entries(pathCounts)) {
      if (path in hiveMetrics.processingPathDistribution) {
        hiveMetrics.processingPathDistribution[path] += count;
      }
    }
  }

  hiveMetrics.recentCascades.push({
    ...cascadeSummary,
    completedAt: new Date().toISOString(),
  });
  if (hiveMetrics.recentCascades.length > 20) {
    hiveMetrics.recentCascades = hiveMetrics.recentCascades.slice(-20);
  }
}

export function getHiveMetrics() {
  return { ...hiveMetrics };
}
