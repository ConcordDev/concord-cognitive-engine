/**
 * Capability Bridge — Wires Underutilized Backend Systems Together
 *
 * Connects:
 *   1. Hypothesis Engine → Autogen Pipeline (auto-propose from conflict pairs)
 *   2. Meta-Learning → Pipeline Strategy (adaptive parameter selection)
 *   3. Swarm Dedup → Pre/post synthesis gate (duplicate prevention)
 *   4. Lattice Beacons → Heartbeat (automatic continuity checks)
 *   5. Empirical Gates → Lens Paper/Science actions (claim validation)
 *   6. Scope Separation → Lens CRUD (scope enforcement on artifacts)
 *
 * Non-negotiable:
 *   - All functions are deterministic or bounded-random
 *   - No hallucination: every proposed hypothesis cites source DTU IDs
 *   - Dedup uses the same Jaccard similarity already in the codebase
 *   - Scope checks are pure gatekeeping — no silent mutations
 */

import { runEmpiricalGates } from "./empirical-gates.js";
import logger from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowISO() {
  return new Date().toISOString();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function simpleTokens(text) {
  if (!text || typeof text !== "string") return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── 1. Hypothesis Auto-Propose from Conflict Pairs ──────────────────────────

/**
 * Given conflict pairs found by the autogen pipeline's selectIntent,
 * auto-propose hypotheses to the Hypothesis Engine for evaluation.
 *
 * @param {object} STATE - server state
 * @param {Array}  conflictPairs - [{dtuA, dtuB, field, reason}]
 * @param {object} opts - { maxProposals?: number }
 * @returns {{ ok, proposed, skipped, errors }}
 */
export function autoHypothesisFromConflicts(STATE, conflictPairs, opts = {}) {
  if (!Array.isArray(conflictPairs) || conflictPairs.length === 0) {
    return { ok: true, proposed: [], skipped: 0, errors: [] };
  }

  // Ensure hypothesis engine state
  if (!STATE.hypothesisEngine) {
    STATE.hypothesisEngine = {
      hypotheses: new Map(),
      experiments: new Map(),
      evidence: new Map(),
      stats: { proposed: 0, supported: 0, refuted: 0, inconclusive: 0 },
      config: {
        minEvidenceToDecide: 3,
        supportThreshold: 0.7,
        refuteThreshold: 0.3,
        priorWeight: 0.3,
      },
    };
  }
  const he = STATE.hypothesisEngine;
  if (!(he.hypotheses instanceof Map)) {
    he.hypotheses = new Map(Object.entries(he.hypotheses || {}));
  }
  if (!(he.experiments instanceof Map)) {
    he.experiments = new Map(Object.entries(he.experiments || {}));
  }
  if (!(he.evidence instanceof Map)) {
    he.evidence = new Map(Object.entries(he.evidence || {}));
  }

  const maxProposals = clamp(opts.maxProposals || 3, 1, 10);
  const proposed = [];
  const errors = [];
  let skipped = 0;

  // Check existing hypotheses to avoid duplicates
  const existingPairs = new Set();
  for (const h of he.hypotheses.values()) {
    const ids = (h.relatedDtuIds || []).sort().join(",");
    if (ids) existingPairs.add(ids);
  }

  for (const pair of conflictPairs.slice(0, maxProposals * 2)) {
    if (proposed.length >= maxProposals) break;

    const { dtuA, dtuB, field, reason } = pair;
    if (!dtuA || !dtuB) {
      skipped++;
      continue;
    }

    // Skip if we already have a hypothesis for this pair
    const pairKey = [dtuA, dtuB].sort().join(",");
    if (existingPairs.has(pairKey)) {
      skipped++;
      continue;
    }

    // Look up DTU titles for a meaningful statement
    const dA = STATE.dtus?.get(dtuA);
    const dB = STATE.dtus?.get(dtuB);
    const titleA = (dA?.title || dtuA).slice(0, 80);
    const titleB = (dB?.title || dtuB).slice(0, 80);
    const fieldNote = field ? ` on field "${field}"` : "";
    const reasonNote = reason ? ` (${reason})` : "";

    const statement = `DTU "${titleA}" and DTU "${titleB}" contain conflicting claims${fieldNote}${reasonNote}. If the claims in "${titleA}" are correct, then "${titleB}" should be revised or retracted.`;

    const id = `hyp_bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const hypothesis = {
      id,
      statement,
      domain: "conflict_resolution",
      falsifiable: true,
      falsificationCriteria: `Find evidence supporting or contradicting the claims in either DTU. Compare with authoritative sources.`,
      priorConfidence: 0.5,
      state: "proposed",
      posteriorConfidence: 0.5,
      evidenceFor: [],
      evidenceAgainst: [],
      experiments: [],
      source: "capability_bridge.auto",
      relatedDtuIds: [dtuA, dtuB],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    he.hypotheses.set(id, hypothesis);
    he.stats.proposed++;
    existingPairs.add(pairKey);
    proposed.push({ id, dtuA, dtuB, statement: statement.slice(0, 200) });
  }

  return { ok: true, proposed, skipped, errors };
}

// ── 2. Meta-Learning Strategy Advisor for Pipeline ──────────────────────────

/**
 * Query the meta-learning engine for the best synthesis strategy
 * and return tuning hints for the autogen pipeline.
 *
 * @param {object} STATE
 * @param {string} domain - e.g. "autogen", "dream", "synth", "evolution"
 * @returns {{ ok, strategy, hints }}
 */
export function getPipelineStrategyHints(STATE, domain = "autogen") {
  if (!STATE.metaLearning) {
    return { ok: true, strategy: null, hints: {}, reason: "meta_learning_not_initialized" };
  }

  const ml = STATE.metaLearning;
  if (!(ml.strategies instanceof Map)) {
    ml.strategies = new Map(Object.entries(ml.strategies || {}));
  }

  // Find best strategy for domain or fallback to "general"
  const strategies = Array.from(ml.strategies.values())
    .filter((s) => s.domain === domain || s.domain === "general")
    .filter((s) => s.uses >= 3)
    .sort((a, b) => b.avgPerformance - a.avgPerformance);

  if (strategies.length === 0) {
    return { ok: true, strategy: null, hints: {}, reason: "no_strategy_data" };
  }

  const best = strategies[0];

  // Translate meta-learning parameters into pipeline tuning hints
  const hints = {
    explorationRate: best.parameters?.explorationRate ?? 0.2,
    batchSize: best.parameters?.batchSize ?? 5,
    abstractionLevel: best.parameters?.abstractionLevel ?? 1,
    consolidationThreshold: best.parameters?.consolidationThreshold ?? 0.7,
    // Higher exploration = prefer fill_gaps/extract_patterns
    // Lower exploration = prefer compress_clusters/elevate_high_usage
    preferredIntentBias: best.parameters?.explorationRate > 0.3
      ? "exploratory"
      : "consolidative",
  };

  return { ok: true, strategy: { id: best.id, name: best.name, avgPerformance: best.avgPerformance }, hints };
}

/**
 * Record the outcome of a pipeline run back to meta-learning for adaptation.
 *
 * @param {object} STATE
 * @param {string} strategyId
 * @param {boolean} success
 * @param {number} performance - 0..1
 */
export function recordPipelineOutcomeToMetaLearning(STATE, strategyId, success, performance) {
  if (!STATE.metaLearning || !strategyId) return { ok: false, reason: "no_meta_learning" };

  const ml = STATE.metaLearning;
  if (!(ml.strategies instanceof Map)) {
    ml.strategies = new Map(Object.entries(ml.strategies || {}));
  }

  const strategy = ml.strategies.get(strategyId);
  if (!strategy) return { ok: false, reason: "strategy_not_found" };

  const perf = clamp(performance, 0, 1);
  strategy.uses++;
  if (success) strategy.successes++;
  else strategy.failures++;

  strategy.avgPerformance =
    (strategy.avgPerformance * (strategy.uses - 1) + perf) / strategy.uses;
  strategy.updatedAt = nowISO();

  ml.performance.push({
    strategyId,
    success,
    performance: perf,
    domain: strategy.domain,
    recordedAt: nowISO(),
  });

  if (ml.performance.length > 1000) {
    ml.performance = ml.performance.slice(-1000);
  }

  return { ok: true, newAvgPerformance: strategy.avgPerformance };
}

// ── 3. Swarm Dedup Gate for Pipeline ────────────────────────────────────────

/**
 * Check whether a pipeline candidate is a near-duplicate of existing DTUs.
 * Returns pass/fail + the closest match if found.
 *
 * @param {object} STATE
 * @param {object} candidate - { title, tags, claims }
 * @param {object} opts - { threshold?: number, limit?: number }
 * @returns {{ ok, isDuplicate, closestMatch, similarity }}
 */
export function dedupGate(STATE, candidate, opts = {}) {
  const threshold = opts.threshold ?? 0.72;
  const limit = opts.limit ?? 500;

  if (!candidate || !STATE.dtus) {
    return { ok: true, isDuplicate: false, closestMatch: null, similarity: 0 };
  }

  const candidateText = [
    candidate.title || "",
    ...(candidate.tags || []),
    ...(candidate.claims || []).map((c) => (typeof c === "string" ? c : c.text || "")),
  ].join(" ");

  const candidateTokens = simpleTokens(candidateText);
  if (candidateTokens.size === 0) {
    return { ok: true, isDuplicate: false, closestMatch: null, similarity: 0 };
  }

  let bestMatch = null;
  let bestSim = 0;
  let checked = 0;

  for (const dtu of STATE.dtus.values()) {
    if (checked >= limit) break;
    checked++;

    const dtuText = [
      dtu.title || "",
      ...(dtu.tags || []),
      ...(dtu.core?.claims || []).map((c) => (typeof c === "string" ? c : c.text || "")),
    ].join(" ");

    const dtuTokens = simpleTokens(dtuText);
    const sim = jaccard(candidateTokens, dtuTokens);

    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = { id: dtu.id, title: (dtu.title || "").slice(0, 100), similarity: sim };
    }
  }

  const isDuplicate = bestSim >= threshold;

  return {
    ok: true,
    isDuplicate,
    closestMatch: bestMatch,
    similarity: bestSim,
    threshold,
    checked,
  };
}

/**
 * Run a post-synthesis dedup sweep on recent DTUs.
 * Identifies near-duplicates but does NOT merge — returns proposals.
 *
 * @param {object} STATE
 * @param {object} opts - { threshold?, windowSize? }
 * @returns {{ ok, duplicatePairs, scanned }}
 */
export function scanRecentDuplicates(STATE, opts = {}) {
  const threshold = opts.threshold ?? 0.82;
  const windowSize = opts.windowSize ?? 100;

  if (!STATE.dtus) {
    return { ok: true, duplicatePairs: [], scanned: 0 };
  }

  const dtus = Array.from(STATE.dtus.values())
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, windowSize);

  const pairs = [];

  for (let i = 0; i < dtus.length; i++) {
    const aText = [dtus[i].title || "", ...(dtus[i].tags || [])].join(" ");
    const aTok = simpleTokens(aText);

    for (let j = i + 1; j < dtus.length; j++) {
      const bText = [dtus[j].title || "", ...(dtus[j].tags || [])].join(" ");
      const bTok = simpleTokens(bText);
      const sim = jaccard(aTok, bTok);

      if (sim >= threshold) {
        pairs.push({
          dtuA: dtus[i].id,
          dtuB: dtus[j].id,
          titleA: (dtus[i].title || "").slice(0, 80),
          titleB: (dtus[j].title || "").slice(0, 80),
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  return { ok: true, duplicatePairs: pairs, scanned: dtus.length, threshold };
}

// ── 4. Beacon Heartbeat Hook ────────────────────────────────────────────────

/**
 * Lightweight beacon/continuity check suitable for heartbeat cadence.
 * Checks lattice integrity and DTU count stability.
 *
 * @param {object} STATE
 * @returns {{ ok, healthy, checks }}
 */
export function runBeaconCheck(STATE) {
  const checks = [];
  let healthy = true;

  // Check 1: DTU count not zero (lattice alive)
  const dtuCount = STATE.dtus?.size || 0;
  checks.push({
    name: "lattice_alive",
    pass: dtuCount > 0,
    detail: `DTU count: ${dtuCount}`,
  });
  if (dtuCount === 0) healthy = false;

  // Check 2: No runaway growth (DTU count < 50k)
  const growthOk = dtuCount < 50000;
  checks.push({
    name: "growth_bounded",
    pass: growthOk,
    detail: `DTU count ${dtuCount} ${growthOk ? "<" : ">="} 50000 limit`,
  });
  if (!growthOk) healthy = false;

  // Check 3: Hypothesis engine not stalling (if initialized)
  if (STATE.hypothesisEngine) {
    const he = STATE.hypothesisEngine;
    const _hypCount = he.hypotheses instanceof Map ? he.hypotheses.size : 0;
    const proposed = he.stats?.proposed || 0;
    const decided = (he.stats?.supported || 0) + (he.stats?.refuted || 0) + (he.stats?.inconclusive || 0);
    const ratio = proposed > 0 ? decided / proposed : 1;
    checks.push({
      name: "hypothesis_throughput",
      pass: ratio >= 0.1 || proposed < 5,
      detail: `${decided}/${proposed} decided (${(ratio * 100).toFixed(0)}%)`,
    });
  }

  // Check 4: Meta-learning has strategies (if initialized)
  if (STATE.metaLearning) {
    const ml = STATE.metaLearning;
    const stratCount = ml.strategies instanceof Map ? ml.strategies.size : 0;
    checks.push({
      name: "metalearning_active",
      pass: true,
      detail: `${stratCount} strategies, ${ml.adaptations?.length || 0} adaptations`,
    });
  }

  // Check 5: Recent DTUs have scope assigned
  if (STATE.dtus && STATE.dtus.size > 0) {
    let scopedCount = 0;
    let sampleSize = 0;
    for (const dtu of STATE.dtus.values()) {
      if (sampleSize >= 100) break;
      sampleSize++;
      if (dtu.scope) scopedCount++;
    }
    const scopeRatio = sampleSize > 0 ? scopedCount / sampleSize : 1;
    checks.push({
      name: "scope_coverage",
      pass: scopeRatio >= 0.5 || STATE.dtus.size < 10,
      detail: `${scopedCount}/${sampleSize} sampled DTUs have scope (${(scopeRatio * 100).toFixed(0)}%)`,
    });
  }

  return { ok: true, healthy, checks, checkedAt: nowISO() };
}

// ── 5. Lens Scope Enforcement ───────────────────────────────────────────────

/**
 * Validate that a lens artifact operation respects scope boundaries.
 * Local artifacts can only reference local DTUs; global artifacts
 * can reference global DTUs.
 *
 * @param {object} artifact - { domain, data, meta }
 * @param {string} operation - "create"|"update"|"delete"
 * @param {object} opts - { actorScope?, enforceStrict? }
 * @returns {{ ok, allowed, warnings }}
 */
export function lensCheckScope(artifact, operation, opts = {}) {
  const warnings = [];
  const actorScope = opts.actorScope || "local";

  if (!artifact) {
    return { ok: true, allowed: true, warnings: [] };
  }

  // Global artifacts can only be created/modified by global-scope actors
  const artifactScope = artifact.meta?.scope || "local";

  if (artifactScope === "global" && actorScope !== "global") {
    return {
      ok: true,
      allowed: false,
      warnings: [`Cannot ${operation} global artifact from ${actorScope} scope`],
    };
  }

  // Warn if artifact references DTUs from a higher scope
  const referencedDtuIds = extractReferencedDtuIds(artifact);
  if (referencedDtuIds.length > 0 && opts.STATE) {
    for (const id of referencedDtuIds.slice(0, 20)) {
      const dtu = opts.STATE.dtus?.get(id);
      if (dtu?.scope === "global" && artifactScope === "local") {
        warnings.push(`Local artifact references global DTU ${id}`);
      }
    }
  }

  return { ok: true, allowed: true, warnings };
}

function extractReferencedDtuIds(artifact) {
  const ids = [];
  if (!artifact?.data) return ids;

  // Look in common fields that might reference DTU IDs
  const data = artifact.data;
  if (Array.isArray(data.claims)) {
    for (const c of data.claims) {
      if (c.dtuId) ids.push(c.dtuId);
      if (Array.isArray(c.sources)) ids.push(...c.sources.filter((s) => typeof s === "string"));
    }
  }
  if (Array.isArray(data.references)) {
    ids.push(...data.references.filter((r) => typeof r === "string"));
  }
  if (data.dtuId) ids.push(data.dtuId);

  return ids;
}

// ── 6. Lens Empirical Validation ────────────────────────────────────────────

/**
 * Run empirical gates on a lens artifact's claims.
 * Designed for paper and science domain artifacts.
 *
 * @param {object} artifact - { data: { claims } }
 * @returns {{ ok, results, issueCount }}
 */
export function lensValidateEmpirically(artifact) {
  if (!artifact?.data) {
    return { ok: true, results: [], issueCount: 0, reason: "no_data" };
  }

  const claims = artifact.data.claims || [];
  if (claims.length === 0) {
    return { ok: true, results: [], issueCount: 0, reason: "no_claims" };
  }

  const results = [];
  let issueCount = 0;

  for (const claim of claims.slice(0, 50)) {
    const text = typeof claim === "string" ? claim : claim.text || claim.statement || "";
    if (!text) continue;

    // Build a pseudo-candidate for empirical gates
    const candidate = {
      title: (artifact.title || "").slice(0, 120),
      claims: [text],
    };

    const gateResult = runEmpiricalGates(candidate);
    const claimIssues = gateResult.issues || [];

    results.push({
      claim: text.slice(0, 200),
      claimId: claim.id || null,
      issues: claimIssues.map((i) => ({
        gate: i.gate,
        rule: i.rule,
        severity: i.severity,
        detail: i.detail,
      })),
      passed: claimIssues.filter((i) => i.severity === "error").length === 0,
    });

    issueCount += claimIssues.length;
  }

  return {
    ok: true,
    results,
    issueCount,
    claimsChecked: results.length,
    passRate:
      results.length > 0
        ? Math.round((results.filter((r) => r.passed).length / results.length) * 100) / 100
        : 1,
  };
}

// ── 7. Enhanced Heartbeat Hook ──────────────────────────────────────────────

/**
 * Run all bridge checks in a single heartbeat cycle.
 * This is called from the heartbeat in server.js.
 *
 * Returns a summary of what was done.
 *
 * @param {object} STATE
 * @param {object} opts - { dedupEnabled?, hypothesisEnabled?, beaconEnabled? }
 * @returns {{ ok, beacon, dedup, hypotheses }}
 */
export async function runHeartbeatBridgeTick(STATE, opts = {}) {
  const result = {
    ok: true,
    beacon: null,
    dedup: null,
    hypotheses: null,
    timestamp: nowISO(),
  };

  // 1. Beacon check (always runs)
  if (opts.beaconEnabled !== false) {
    result.beacon = runBeaconCheck(STATE);
  }

  // 2. Dedup scan (every tick, lightweight)
  if (opts.dedupEnabled !== false && STATE.dtus?.size > 20) {
    result.dedup = scanRecentDuplicates(STATE, {
      threshold: 0.82,
      windowSize: 50,
    });
  }

  // 3. Auto-hypothesis from any accumulated pipeline conflicts
  if (opts.hypothesisEnabled !== false) {
    const pipelineState = STATE._autogenPipeline;
    const recentConflicts = pipelineState?._recentConflicts || [];
    if (recentConflicts.length > 0) {
      result.hypotheses = autoHypothesisFromConflicts(STATE, recentConflicts, {
        maxProposals: 2,
      });
      // Clear after processing
      if (pipelineState) pipelineState._recentConflicts = [];
    }
  }

  // 4. Pain/avoidance → autogen intent filtering
  // If any entity has active avoidance memories for certain domains, penalize
  // those domains in autogen intent scoring
  if (opts.avoidanceEnabled !== false) {
    try {
      const avoidanceMod = await importModule("./avoidance-learning.js");
      const bodyMod = await importModule("./body-instantiation.js");
      if (avoidanceMod?.getAvoidanceMemories && bodyMod?.listBodies) {
        const bodies = bodyMod.listBodies();
        const avoidedDomains = new Set();
        for (const b of bodies) {
          const memories = avoidanceMod.getAvoidanceMemories(b.entityId);
          for (const mem of memories) {
            if (mem.domain) avoidedDomains.add(mem.domain);
            if (mem.tags) mem.tags.forEach(t => avoidedDomains.add(t));
          }
        }
        if (avoidedDomains.size > 0) {
          // Store avoided domains for autogen to consult
          if (!STATE._autogenPipeline) STATE._autogenPipeline = {};
          STATE._autogenPipeline._avoidedDomains = Array.from(avoidedDomains);
          result.avoidance = { domainsAvoided: avoidedDomains.size };
        }
      }
    } catch (_e) { logger.debug('emergent:capability-bridge', 'avoidance bridge is non-critical', { error: _e?.message }); }
  }

  // 5. Culture → governance voting weight influence
  // Established traditions modify council confidence thresholds
  if (opts.cultureEnabled !== false) {
    try {
      const cultureMod = await importModule("./culture-layer.js");
      if (cultureMod?.getEstablishedTraditions) {
        const traditions = cultureMod.getEstablishedTraditions();
        const traditionCount = traditions?.length || 0;
        if (traditionCount > 0) {
          // Store cultural weight modifier for governance to consult
          // More established traditions = stricter review (higher bar for new DTUs)
          const culturalStrictness = clamp(1 + traditionCount * 0.02, 1.0, 1.3);
          if (!STATE._governanceConfig) STATE._governanceConfig = {};
          STATE._governanceConfig._culturalStrictnessModifier = culturalStrictness;
          result.culture = { traditions: traditionCount, strictnessModifier: culturalStrictness };
        }
      }
    } catch (_e) { logger.debug('emergent:capability-bridge', 'culture bridge is non-critical', { error: _e?.message }); }
  }

  // 6. Creative masterworks → council governance promotion
  // Promote creative works with avg reception > 0.9 through DTU governance
  if (opts.creativeEnabled !== false) {
    try {
      const creativeMod = await importModule("./creative-generation.js");
      if (creativeMod?.getMasterworks) {
        const masterworks = creativeMod.getMasterworks();
        let promoted = 0;
        for (const work of masterworks) {
          if (work._promotedToDtu) continue; // already promoted
          // Create a DTU from the masterwork
          // Duck-type: STATE.dtus is a write-through store (has .set()) once
          // wired, not a literal Map.
          if (typeof STATE.dtus?.set === "function") {
            const dtuId = `dtu_cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
            STATE.dtus.set(dtuId, {
              id: dtuId,
              title: `Creative Work: ${work.title || work.mode || "Untitled"}`,
              kind: "creative_masterwork",
              tier: "shadow", // starts as shadow, governance promotes
              tags: ["creative", "masterwork", work.mode || "art", ...(work.tags || [])],
              content: work.content || work.description || "",
              meta: {
                creativeWorkId: work.id,
                mode: work.mode,
                entityId: work.entityId,
                avgReception: work.avgReception,
                needsCouncilVote: true,
              },
              authority: 0.7,
              resonance: work.avgReception || 0.9,
              createdAt: nowISO(),
            });
            work._promotedToDtu = dtuId;
            promoted++;
          }
          if (promoted >= 3) break; // cap per tick
        }
        if (promoted > 0) result.creative = { masterworksPromoted: promoted };
      }
    } catch (_e) { logger.debug('emergent:capability-bridge', 'creative bridge is non-critical', { error: _e?.message }); }
  }

  // 7. HLR → Hypothesis Engine: feed HLR reasoning findings into hypotheses
  if (opts.hlrEnabled !== false) {
    try {
      const hlrMod = await importModule("./hlr-engine.js");
      const hypoMod = await importModule("./hypothesis-engine.js");
      if (hlrMod?.getRecentFindings && hypoMod?.proposeHypothesis) {
        const findings = hlrMod.getRecentFindings ? hlrMod.getRecentFindings() : [];
        let proposed = 0;
        for (const finding of findings) {
          if (finding._hypothesized) continue;
          if (finding.proposedDTUs?.length > 0 || finding.patterns?.length > 0) {
            const statement = finding.conclusion || finding.summary ||
              `HLR finding: ${(finding.patterns || []).map(p => p.description || p.label).join("; ")}`;
            if (statement && statement.length > 10) {
              try {
                hypoMod.proposeHypothesis(statement, finding.domain || "general", "normal");
                finding._hypothesized = true;
                proposed++;
              } catch (_e) { logger.debug('emergent:capability-bridge', 'silent catch', { error: _e?.message }); }
            }
          }
          if (proposed >= 3) break; // cap per tick
        }
        if (proposed > 0) result.hlr = { hypothesesProposed: proposed };
      }
    } catch (_e) { logger.debug('emergent:capability-bridge', 'HLR bridge is non-critical', { error: _e?.message }); }
  }

  return result;
}

// Helper for dynamic imports in the bridge
async function importModule(path) {
  try { return await import(path); } catch (err) { console.debug('[capability-bridge] dynamic import failed', { path, err: err?.message }); return null; }
}

// ── 8. Bootstrap Meta-Learning Strategies ───────────────────────────────────

/**
 * Ensure baseline meta-learning strategies exist for the autogen pipeline domains.
 * Called once during init.
 *
 * @param {object} STATE
 * @returns {{ ok, created }}
 */
export function ensureBaselineStrategies(STATE) {
  if (!STATE.metaLearning) {
    STATE.metaLearning = {
      strategies: new Map(),
      performance: [],
      adaptations: [],
      curriculum: [],
      stats: { strategiesAdapted: 0, performanceImprovements: 0, curriculumsGenerated: 0 },
      config: { adaptationRate: 0.1, minSamples: 5, performanceWindow: 20 },
    };
  }

  const ml = STATE.metaLearning;
  if (!(ml.strategies instanceof Map)) {
    ml.strategies = new Map(Object.entries(ml.strategies || {}));
  }

  const domains = ["autogen", "dream", "synth", "evolution"];
  const created = [];

  for (const domain of domains) {
    // Check if any strategy exists for this domain
    const exists = Array.from(ml.strategies.values()).some(
      (s) => s.domain === domain
    );
    if (exists) continue;

    const id = `strat_bridge_${domain}_${Date.now().toString(36)}`;
    const strategy = {
      id,
      name: `${domain} baseline`,
      domain,
      parameters: {
        learningRate: 0.1,
        explorationRate: domain === "dream" ? 0.3 : domain === "evolution" ? 0.1 : 0.2,
        batchSize: 5,
        abstractionLevel: domain === "evolution" ? 2 : 1,
        consolidationThreshold: 0.7,
      },
      uses: 0,
      successes: 0,
      failures: 0,
      avgPerformance: 0.5,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    ml.strategies.set(id, strategy);
    created.push({ id, domain });
  }

  return { ok: true, created };
}

// ── Exports ─────────────────────────────────────────────────────────────────

export function getCapabilityBridgeInfo() {
  return {
    ok: true,
    version: "1.0.0",
    bridges: [
      { name: "hypothesis_auto_propose", desc: "Auto-proposes hypotheses from autogen conflict pairs" },
      { name: "metalearning_strategy", desc: "Queries meta-learning for pipeline tuning hints" },
      { name: "dedup_gate", desc: "Pre-synthesis duplicate check via Jaccard similarity" },
      { name: "dedup_scan", desc: "Post-synthesis scan for recent duplicates" },
      { name: "beacon_check", desc: "Heartbeat continuity/integrity check" },
      { name: "lens_scope", desc: "Scope enforcement on lens CRUD operations" },
      { name: "lens_empirical", desc: "Empirical gates validation for lens claims" },
      { name: "heartbeat_bridge", desc: "Composite heartbeat tick running all bridge checks" },
      { name: "avoidance_filter", desc: "Pain avoidance memories influence autogen domain selection" },
      { name: "culture_governance", desc: "Established traditions adjust governance strictness" },
      { name: "creative_promotion", desc: "Creative masterworks promoted to DTUs through governance" },
      { name: "hlr_hypothesis", desc: "HLR reasoning findings auto-propose hypotheses" },
    ],
  };
}
