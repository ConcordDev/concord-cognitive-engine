/**
 * System: Adjacent Reality Explorer
 *
 * Turns the lattice from a knowledge store into a research tool. Given
 * constraints, explores what COULD BE — not just what IS. Generates adjacent
 * configurations by varying parameters one at a time, checks against known
 * physics/invariants, estimates confidence, and optionally runs HLR reasoning
 * on the most promising candidates.
 *
 * This is the backend for the Lab lens.
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";
import logger from '../logger.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "explore") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Module State ────────────────────────────────────────────────────────────

const _explorations = new Map();
const MAX_EXPLORATIONS = 200;

// ── Retrieval Helpers ───────────────────────────────────────────────────────

function constraintsToQuery(constraints) {
  return Object.entries(constraints)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(", ");
}

async function retrieveDTUs(query, opts = {}) {
  // Use global retrieval if available
  if (typeof globalThis._concordRetrieve === "function") {
    try { return await globalThis._concordRetrieve(query, opts); } catch (_e) { logger.debug('emergent:reality-explorer', 'fallback', { error: _e?.message }); }
  }
  // Fallback: basic keyword search over STATE.dtus
  const STATE = getSTATE();
  if (!STATE?.dtus) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const results = [];
  for (const dtu of STATE.dtus.values()) {
    const text = `${dtu.human?.summary || ""} ${(dtu.tags || []).join(" ")}`.toLowerCase();
    const matchCount = terms.filter(t => text.includes(t)).length;
    if (matchCount > 0) {
      results.push({ ...dtu, _score: matchCount / terms.length });
    }
  }
  results.sort((a, b) => b._score - a._score);
  return results.slice(0, opts.topK || 20);
}

// ── Constraint Matching ─────────────────────────────────────────────────────

function satisfiesConstraints(dtu, constraints) {
  for (const [key, value] of Object.entries(constraints)) {
    const dtuValue = dtu.machine?.[key] || dtu.human?.[key];
    if (dtuValue === undefined) continue;

    if (typeof value === "object" && value.min !== undefined && value.max !== undefined) {
      const numVal = parseFloat(dtuValue);
      if (isNaN(numVal) || numVal < value.min || numVal > value.max) return false;
    } else if (dtuValue !== value) {
      return false;
    }
  }
  return true;
}

// ── Parameter Space Extraction ──────────────────────────────────────────────

function extractParameterSpace(dtus) {
  const space = {};
  for (const dtu of dtus) {
    if (!dtu.machine) continue;
    for (const [key, value] of Object.entries(dtu.machine)) {
      if (key.startsWith("_") || typeof value === "object") continue;
      const num = parseFloat(value);
      if (isNaN(num)) continue;

      if (!space[key]) space[key] = { min: num, max: num, values: [] };
      space[key].min = Math.min(space[key].min, num);
      space[key].max = Math.max(space[key].max, num);
      space[key].values.push(num);
    }
  }
  return space;
}

function extractParameters(dtu) {
  const params = {};
  if (!dtu.machine) return params;
  for (const [key, value] of Object.entries(dtu.machine)) {
    if (key.startsWith("_") || typeof value === "object") continue;
    params[key] = value;
  }
  return params;
}

// ── Variation Generation ────────────────────────────────────────────────────

function generateVariations(param, range, constraints) {
  const variations = [];
  const span = range.max - range.min;
  if (span === 0) return [];

  const steps = 5;
  const stepSize = span / steps;

  for (let i = 0; i <= steps; i++) {
    const value = range.min + (stepSize * i);
    const config = { ...constraints, [param]: parseFloat(value.toFixed(4)) };
    variations.push(config);
  }

  // Also try beyond known range (adjacent reality)
  variations.push({ ...constraints, [param]: parseFloat((range.min - stepSize).toFixed(4)) });
  variations.push({ ...constraints, [param]: parseFloat((range.max + stepSize).toFixed(4)) });

  return variations;
}

// ── Physics Constraints ─────────────────────────────────────────────────────

async function checkPhysicsConstraints(variation, domain) {
  // Basic sanity checks
  const issues = [];
  for (const [key, value] of Object.entries(variation)) {
    if (typeof value === "number") {
      if (key.includes("temperature") && value < 0) issues.push(`${key} below absolute zero`);
      if (key.includes("pressure") && value < 0) issues.push(`${key} negative pressure`);
      if (key.includes("mass") && value <= 0) issues.push(`${key} non-positive mass`);
      if (key.includes("energy") && value < 0) issues.push(`${key} negative energy`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// ── Confidence Estimation ───────────────────────────────────────────────────

function estimateConfidence(variation, knownDTUs, physicsCheck) {
  let confidence = 0.5; // Start at 50%

  // Physics validity bonus
  if (physicsCheck.valid) confidence += 0.2;
  else confidence -= 0.3;

  // Proximity to known data points
  if (knownDTUs.length > 0) {
    confidence += Math.min(knownDTUs.length / 20, 0.2);
  }

  return Math.max(0, Math.min(1, confidence));
}

function findMostSimilar(variation, knownDTUs) {
  if (!knownDTUs.length) return null;
  return {
    id: knownDTUs[0].id,
    summary: knownDTUs[0].human?.summary?.slice(0, 100),
  };
}

function suggestNextStep(variation, confidence, physicsCheck) {
  if (!physicsCheck.valid) return "Resolve physics violations before proceeding";
  if (confidence > 0.7) return "High confidence — consider creating as hypothesis DTU";
  if (confidence > 0.4) return "Moderate confidence — gather more data on key parameters";
  return "Low confidence — needs more foundational data in this parameter space";
}

// ── Main Exploration ────────────────────────────────────────────────────────

export async function exploreAdjacent(constraints, domain) {
  const STATE = getSTATE();
  if (!STATE) return { ok: false, error: "STATE not available" };

  // 1. Find existing DTUs that match
  const known = await retrieveDTUs(constraintsToQuery(constraints), { topK: 20 });
  const matching = known.filter(dtu => satisfiesConstraints(dtu, constraints));

  // 2. Extract parameter space
  const parameterSpace = extractParameterSpace(matching);

  // 3. Generate adjacent configurations
  const adjacentConfigs = [];
  for (const param of Object.keys(parameterSpace)) {
    const range = parameterSpace[param];
    const variations = generateVariations(param, range, constraints);

    for (const variation of variations) {
      const physicsCheck = await checkPhysicsConstraints(variation, domain);
      const confidence = estimateConfidence(variation, matching, physicsCheck);

      adjacentConfigs.push({
        configuration: variation,
        confidence,
        physicsCheck,
        knownSimilar: findMostSimilar(variation, matching),
        nextStep: suggestNextStep(variation, confidence, physicsCheck),
      });
    }
  }

  // 4. If HLR is available, run reasoning on most promising
  const promising = adjacentConfigs.filter(c => c.confidence > 0.4).slice(0, 5);
  if (globalThis._concordHLR?.reason) {
    for (const config of promising) {
      try {
        config.reasoning = await globalThis._concordHLR.reason({
          mode: "abductive",
          premise: `Given constraints: ${JSON.stringify(constraints)}, is configuration ${JSON.stringify(config.configuration)} feasible?`,
          domain,
        });
      } catch (_e) { logger.debug('emergent:reality-explorer', 'HLR unavailable', { error: _e?.message }); }
    }
  }

  const result = {
    ok: true,
    id: uid("explore"),
    domain,
    constraints,
    knownMatches: matching.map(d => ({
      id: d.id,
      summary: d.human?.summary,
      parameters: extractParameters(d),
    })),
    adjacentRealities: adjacentConfigs.sort((a, b) => b.confidence - a.confidence),
    explorationDepth: adjacentConfigs.length,
    timestamp: nowISO(),
  };

  // Save exploration
  _explorations.set(result.id, result);
  if (_explorations.size > MAX_EXPLORATIONS) {
    const oldest = _explorations.keys().next().value;
    _explorations.delete(oldest);
  }

  return result;
}

// ── Save Exploration as DTU Cluster ─────────────────────────────────────────

export function saveExploration(explorationId) {
  const STATE = getSTATE();
  const exploration = _explorations.get(explorationId);
  if (!exploration) return { ok: false, error: "Exploration not found" };
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };

  const clusterId = uid("explore_cluster");
  const dtu = {
    id: clusterId,
    type: "exploration_cluster",
    tier: "shadow",
    title: `Exploration: ${exploration.domain} — ${Object.keys(exploration.constraints).join(", ")}`,
    human: {
      summary: `Adjacent reality exploration of ${exploration.domain}. ${exploration.adjacentRealities.length} configurations explored, ${exploration.knownMatches.length} known matches.`,
    },
    machine: {
      kind: "exploration_cluster",
      explorationId,
      domain: exploration.domain,
      constraints: exploration.constraints,
      configCount: exploration.adjacentRealities.length,
      topConfidence: exploration.adjacentRealities[0]?.confidence || 0,
    },
    tags: ["exploration", `domain:${exploration.domain}`, "reality_explorer"],
    source: "reality_explorer",
    authority: { model: "reality_explorer", score: 0.6 },
    lineage: { parents: [], children: [] },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  STATE.dtus.set(clusterId, dtu);
  return { ok: true, dtuId: clusterId };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getExplorationHistory(limit = 20) {
  const explorations = Array.from(_explorations.values())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

  return {
    ok: true,
    explorations: explorations.map(e => ({
      id: e.id,
      domain: e.domain,
      constraints: e.constraints,
      matchCount: e.knownMatches?.length || 0,
      configCount: e.adjacentRealities?.length || 0,
      timestamp: e.timestamp,
    })),
  };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleExploreCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "explore": {
      const domain = parts[1];
      let constraints = {};
      try { constraints = JSON.parse(parts.slice(2).join(" ")); } catch (_e) { logger.debug('emergent:reality-explorer', 'empty', { error: _e?.message }); }
      return exploreAdjacent(constraints, domain);
    }
    case "explore-history":
      return getExplorationHistory(parseInt(parts[1] || "20", 10));
    case "explore-save":
      return saveExploration(parts[1]);
    default:
      return { ok: false, error: `Unknown explore command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// No-op lifecycle hook: this module needs no init-time wiring. The
// parameters it used to destructure were never referenced, which read as
// though STATE/helpers were used here. Callers still pass them; extra
// arguments are simply ignored, so the interface is unchanged.
export function init() {
  return { ok: true };
}
