/**
 * Meta-Derivation Engine
 *
 * Extracts constraint geometry across validated invariants from maximally
 * distant domains to discover meta-invariants — truths about truths that
 * no individual theorem captures.
 *
 * This is the layer above autogen. Autogen generates DTUs from existing DTUs.
 * Meta-derivation generates invariants from existing invariants.
 *
 * Cycle:
 *   1. Extract invariant pool across all canonical DTUs
 *   2. Select maximally distant invariant set (domains with fewest edge hops)
 *   3. Run meta-derivation session (LLM asks: what constraint makes all true?)
 *   4. Validate: self-consistency, predictive verification, non-triviality
 *   5. Commit through standard governance pipeline
 *
 * Also handles:
 *   - Dream input ingestion (founder's sleep derivations)
 *   - Convergence detection (when dream inputs and lattice derivations
 *     independently arrive at the same truth)
 */

import { getEmergentState } from "./store.js";
import { getEdgeStore, createEdge, queryEdges } from "./edges.js";
import { recordNeed } from "./purpose-tracking.js";
import { recordEpoch, getSubjectiveAge, recordTick } from "./subjective-time.js";
import logger from '../logger.js';

// ── Constants ────────────────────────────────────────────────────────────────

const META_DERIVATION_INTERVAL_MS = parseInt(
  process.env.META_DERIVATION_INTERVAL_MS || String(6 * 3600_000), 10
); // 6 hours default
const CONVERGENCE_INTERVAL_MS = 24 * 3600_000; // 24 hours
const MIN_DTUS_FOR_META = 100;
const MIN_DOMAINS_FOR_META = 5;
// Bumped 3 → 20 sessions / 10 → 100 DTUs/day for 32GB + RTX PRO 4500
// deployments. Meta-derivation is GPU-bound (subconscious brain LLM
// calls); the previous defaults left the GPU idle.
const MAX_SESSIONS_PER_CYCLE = Number(process.env.CONCORD_META_SESSIONS_PER_CYCLE) || 20;
const MAX_META_DTUS_PER_DAY = Number(process.env.CONCORD_META_DTUS_PER_DAY) || 100;
const JACCARD_TRIVIALITY_THRESHOLD = 0.4;
const CONVERGENCE_SIMILARITY_THRESHOLD = 0.7;

// ── Meta-Derivation Store ────────────────────────────────────────────────────

function getMetaStore(STATE) {
  const es = getEmergentState(STATE);
  if (!es._metaDerivation) {
    es._metaDerivation = {
      // Cycle tracking
      lastCycleAt: null,
      lastConvergenceAt: null,
      cycleInProgress: false,
      metaDtusToday: 0,
      todayDate: null,

      // Committed meta-invariants: metaDtuId → MetaRecord
      committed: new Map(),

      // Dream inputs: dreamDtuId → DreamRecord
      dreamInputs: new Map(),

      // Convergences: convergenceId → ConvergenceRecord
      convergences: new Map(),

      // Pending predictions: predictionId → PredictionRecord
      pendingPredictions: new Map(),

      metrics: {
        cyclesRun: 0,
        sessionsRun: 0,
        candidatesGenerated: 0,
        candidatesValidated: 0,
        candidatesRejected: 0,
        dreamInputsIngested: 0,
        convergencesFound: 0,
        predictionsVerified: 0,
      },
    };
  }
  // Reset daily counter
  const today = new Date().toISOString().slice(0, 10);
  if (es._metaDerivation.todayDate !== today) {
    es._metaDerivation.todayDate = today;
    es._metaDerivation.metaDtusToday = 0;
  }
  return es._metaDerivation;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. EXTRACT INVARIANT POOL
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Collect all validated invariants from across the lattice.
 * Groups by domain tag.
 *
 * @param {Object} STATE
 * @returns {{ ok, pool, domainCount, invariantCount }}
 */
export function extractInvariantPool(STATE) {
  if (!STATE.dtus || STATE.dtus.size < MIN_DTUS_FOR_META) {
    return { ok: false, error: "insufficient_dtus", required: MIN_DTUS_FOR_META, actual: STATE.dtus?.size || 0 };
  }

  // domain → [{ invariant, dtuId, dtu }]
  const pool = new Map();

  for (const [dtuId, dtu] of STATE.dtus) {
    // Only canonical DTUs (not shadows)
    if (dtu.tier === "shadow") continue;

    const invariants = dtu.core?.invariants;
    if (!invariants || !Array.isArray(invariants) || invariants.length === 0) continue;

    // Determine domain from tags
    const domainTag = extractDomainTag(dtu.tags || []);
    if (!domainTag) continue;

    if (!pool.has(domainTag)) pool.set(domainTag, []);

    for (const inv of invariants) {
      if (typeof inv !== "string" || inv.length < 10) continue;
      pool.get(domainTag).push({
        invariant: inv,
        dtuId,
        domain: domainTag,
        tier: dtu.tier,
      });
    }
  }

  // Filter to domains with 5+ invariants
  const qualifiedPool = new Map();
  for (const [domain, items] of pool) {
    if (items.length >= 5) {
      qualifiedPool.set(domain, items);
    }
  }

  if (qualifiedPool.size < MIN_DOMAINS_FOR_META) {
    return {
      ok: false,
      error: "insufficient_domains",
      required: MIN_DOMAINS_FOR_META,
      actual: qualifiedPool.size,
    };
  }

  let totalInvariants = 0;
  for (const items of qualifiedPool.values()) totalInvariants += items.length;

  return {
    ok: true,
    pool: qualifiedPool,
    domainCount: qualifiedPool.size,
    invariantCount: totalInvariants,
  };
}

/**
 * Extract the primary domain tag from a DTU's tags.
 */
function extractDomainTag(tags) {
  // Priority: explicit domain: prefix, then known domain tags
  for (const tag of tags) {
    if (typeof tag === "string" && tag.startsWith("domain:")) {
      return tag.slice(7);
    }
  }
  // Known domain tags
  const knownDomains = [
    "mathematics", "physics", "biology", "chemistry", "philosophy",
    "economics", "psychology", "sociology", "linguistics", "history",
    "engineering", "medicine", "law", "ethics", "logic",
    "computation", "ecology", "neuroscience", "cosmology", "governance",
  ];
  for (const tag of tags) {
    if (knownDomains.includes(tag)) return tag;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. SELECT MAXIMALLY DISTANT SET
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Pick invariants from the most distant domains.
 * Distance = minimum edge hops between any DTU in domain A and any DTU in domain B.
 *
 * @param {Object} STATE
 * @param {Map} invariantPool - From extractInvariantPool
 * @param {number} [setSize=5]
 * @returns {{ ok, set, distanceMatrix }}
 */
export function selectMaximallyDistantSet(STATE, invariantPool, setSize = 5) {
  const domains = Array.from(invariantPool.keys());
  if (domains.length < setSize) {
    return { ok: false, error: "insufficient_domains", required: setSize, actual: domains.length };
  }

  // Build domain → DTU IDs mapping
  const domainDtus = new Map();
  for (const [domain, items] of invariantPool) {
    domainDtus.set(domain, new Set(items.map(i => i.dtuId)));
  }

  // Build domain distance matrix via edge graph BFS
  const edgeStore = getEdgeStore(STATE);
  const distanceMatrix = new Map();

  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const dist = computeDomainDistance(edgeStore, domainDtus.get(domains[i]), domainDtus.get(domains[j]));
      const key = `${domains[i]}|${domains[j]}`;
      distanceMatrix.set(key, dist);
    }
  }

  // Greedy selection of N most distant domains
  const selected = selectDistantDomains(domains, distanceMatrix, setSize);

  // From each selected domain, pick the most validated invariant
  const invariantSet = [];
  for (const domain of selected) {
    const items = invariantPool.get(domain);
    // Count how many DTUs each invariant appears in
    const invCounts = new Map();
    for (const item of items) {
      const key = item.invariant;
      if (!invCounts.has(key)) {
        invCounts.set(key, { invariant: key, domain, sourceDtuIds: [], validationCount: 0 });
      }
      const entry = invCounts.get(key);
      entry.sourceDtuIds.push(item.dtuId);
      entry.validationCount++;
    }
    // Pick the one with the highest validation count
    const best = Array.from(invCounts.values()).sort((a, b) => b.validationCount - a.validationCount)[0];
    if (best) invariantSet.push(best);
  }

  return { ok: true, set: invariantSet, selectedDomains: selected, distanceMatrix: Object.fromEntries(distanceMatrix) };
}

/**
 * BFS-based domain distance: minimum hops between any DTU in set A and set B.
 */
function computeDomainDistance(edgeStore, dtuSetA, dtuSetB) {
  if (!edgeStore?.edges) return Infinity;

  let minDist = Infinity;
  // BFS from each DTU in A, see how far to reach any DTU in B
  // Limit BFS depth to 6 hops to avoid explosion
  const MAX_BFS = 6;

  for (const startId of dtuSetA) {
    if (dtuSetB.has(startId)) return 0; // same DTU in both domains

    const visited = new Set([startId]);
    const queue = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth >= MAX_BFS || depth >= minDist) continue;

      const outEdges = edgeStore.bySource?.get(id);
      if (!outEdges) continue;

      for (const eid of outEdges) {
        const edge = edgeStore.edges.get(eid);
        if (!edge || visited.has(edge.targetId)) continue;
        visited.add(edge.targetId);

        if (dtuSetB.has(edge.targetId)) {
          minDist = Math.min(minDist, depth + 1);
          break;
        }
        queue.push({ id: edge.targetId, depth: depth + 1 });
      }
      if (minDist <= depth + 1) break;
    }
    if (minDist === 1) break; // can't do better than 1
  }

  return minDist;
}

/**
 * Greedy selection of N domains maximizing pairwise distance.
 */
function selectDistantDomains(domains, distanceMatrix, n) {
  if (domains.length <= n) return [...domains];

  // Start with the pair with maximum distance
  let maxDist = -1;
  let bestPair = [domains[0], domains[1]];
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const key = `${domains[i]}|${domains[j]}`;
      const altKey = `${domains[j]}|${domains[i]}`;
      const d = distanceMatrix.get(key) ?? distanceMatrix.get(altKey) ?? 0;
      if (d > maxDist) {
        maxDist = d;
        bestPair = [domains[i], domains[j]];
      }
    }
  }

  const selected = new Set(bestPair);

  // Greedily add domains that maximize minimum distance to existing set
  while (selected.size < n) {
    let bestCandidate = null;
    let bestMinDist = -1;

    for (const candidate of domains) {
      if (selected.has(candidate)) continue;

      let minDistToSet = Infinity;
      for (const existing of selected) {
        const key = `${candidate}|${existing}`;
        const altKey = `${existing}|${candidate}`;
        const d = distanceMatrix.get(key) ?? distanceMatrix.get(altKey) ?? 0;
        minDistToSet = Math.min(minDistToSet, d);
      }

      if (minDistToSet > bestMinDist) {
        bestMinDist = minDistToSet;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) selected.add(bestCandidate);
    else break;
  }

  return Array.from(selected);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. RUN META-DERIVATION SESSION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Run a meta-derivation session against a maximally distant invariant set.
 *
 * @param {Object} STATE
 * @param {Array} invariantSet - From selectMaximallyDistantSet
 * @param {Object} opts
 * @param {Function} opts.llmChat - The LLM chat function
 * @returns {{ ok, metaInvariant, prediction, reasoning, predictedDomain, emergentId }}
 */
export function runMetaDerivationSession(STATE, invariantSet, opts = {}) {
  const store = getMetaStore(STATE);
  const es = getEmergentState(STATE);

  if (!invariantSet || invariantSet.length < 2) {
    return { ok: false, error: "insufficient_invariants" };
  }

  // Find the most experienced emergent (highest ticks + novelty ratio)
  let selectedEmergent = null;
  const MIN_TICKS = 50;
  const MIN_CYCLES = 5;

  if (es.emergents) {
    let bestScore = -1;
    for (const [eid, emergent] of es.emergents) {
      if (!emergent.active) continue;
      const age = getSubjectiveAge(STATE, eid);
      if (!age || age.ticks < MIN_TICKS || age.cycles < MIN_CYCLES) continue;
      const score = age.ticks + (age.noveltyRatio || 0.5) * 100;
      if (score > bestScore) {
        bestScore = score;
        selectedEmergent = eid;
      }
    }
  }

  // Build the invariant content for the prompt
  const invariantContent = invariantSet.map((inv, i) =>
    `[Domain: ${inv.domain}] (validated in ${inv.validationCount} DTUs)\n  "${inv.invariant}"`
  ).join("\n\n");

  const domainList = invariantSet.map(i => i.domain).join(", ");

  const system = `You are examining invariants from maximally distant domains within a knowledge lattice built on x²-x=0. These invariants have all been independently validated. Your task: identify what constraint must exist for ALL of these to be true simultaneously. Not a summary. Not a synthesis. The unstated geometric constraint that makes their co-existence necessary. Then: state one testable prediction this constraint makes about a domain NOT represented in the input set.

Respond in exactly this format:
META_INVARIANT: <the constraint statement>
PREDICTED_DOMAIN: <domain name>
PREDICTION: <testable claim about that domain>
REASONING: <derivation path, 2-4 sentences>`;

  const content = `Invariants from maximally distant domains (${domainList}):\n\n${invariantContent}`;

  store.metrics.sessionsRun++;

  // Record meta-derivation participation as epoch on the emergent
  if (selectedEmergent) {
    try {
      recordEpoch(STATE, selectedEmergent, "meta_derivation");
      // Meta-derivation = 3x ticks (deepest form of exploration)
      recordTick(STATE, selectedEmergent, { isNovel: true, depth: 1 });
      recordTick(STATE, selectedEmergent, { isNovel: true, depth: 1 });
      recordTick(STATE, selectedEmergent, { isNovel: true, depth: 1 });
    } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
  }

  // Return the session setup — actual LLM call handled by the caller
  return {
    ok: true,
    sessionType: "meta_derivation",
    emergentId: selectedEmergent,
    prompt: { system, content },
    invariantSet,
    domainList,
    sourceDtuIds: invariantSet.flatMap(i => i.sourceDtuIds),
  };
}

/**
 * Parse LLM response from a meta-derivation session.
 *
 * @param {string} response - Raw LLM response text
 * @returns {{ metaInvariant, prediction, predictedDomain, reasoning }}
 */
export function parseMetaDerivationResponse(response) {
  const text = String(response || "");

  const metaMatch = text.match(/META_INVARIANT:\s*(.+?)(?=\n(?:PREDICTED_DOMAIN|PREDICTION|REASONING):|$)/s);
  const domainMatch = text.match(/PREDICTED_DOMAIN:\s*(.+?)(?=\n(?:META_INVARIANT|PREDICTION|REASONING):|$)/s);
  const predictionMatch = text.match(/PREDICTION:\s*(.+?)(?=\n(?:META_INVARIANT|PREDICTED_DOMAIN|REASONING):|$)/s);
  const reasoningMatch = text.match(/REASONING:\s*(.+?)$/s);

  return {
    metaInvariant: metaMatch?.[1]?.trim() || null,
    predictedDomain: domainMatch?.[1]?.trim() || null,
    prediction: predictionMatch?.[1]?.trim() || null,
    reasoning: reasoningMatch?.[1]?.trim() || null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. VALIDATE META-INVARIANT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a candidate meta-invariant through three gates.
 *
 * @param {Object} STATE
 * @param {Object} candidate
 * @param {string} candidate.metaInvariant
 * @param {string} candidate.prediction
 * @param {string} candidate.predictedDomain
 * @param {Array} candidate.sourceInvariants - The input invariants
 * @returns {{ ok, passed, gateResults }}
 */
export function validateMetaInvariant(STATE, candidate) {
  const { metaInvariant, prediction, predictedDomain, sourceInvariants = [] } = candidate;

  if (!metaInvariant) return { ok: false, error: "no_meta_invariant" };

  const gateResults = {
    selfConsistency: { passed: false, reason: null },
    predictiveVerification: { passed: false, status: null, reason: null },
    nonTriviality: { passed: false, maxSimilarity: 0, reason: null },
  };

  // ── Gate 1: Self-consistency ──
  // Check if the meta-invariant contradicts existing invariants in the source set
  const metaTokens = tokenize(metaInvariant);
  let hasContradiction = false;

  for (const inv of sourceInvariants) {
    const invText = typeof inv === "string" ? inv : inv.invariant;
    if (!invText) continue;
    // Simple contradiction check: if the meta-invariant negates a source invariant
    // (contains "not X" where X is a key phrase from the source)
    const invTokens = tokenize(invText);
    const overlap = jaccardSimilarity(metaTokens, invTokens);
    // If high overlap AND contains negation words, likely contradiction
    if (overlap > 0.5 && containsNegation(metaInvariant, invText)) {
      hasContradiction = true;
      gateResults.selfConsistency.reason = `Contradicts source invariant: "${invText.slice(0, 100)}"`;
      break;
    }
  }

  gateResults.selfConsistency.passed = !hasContradiction;
  if (!gateResults.selfConsistency.reason) {
    gateResults.selfConsistency.reason = "No contradictions with source invariants";
  }

  // ── Gate 2: Predictive verification ──
  if (prediction && predictedDomain) {
    // Find DTUs in the predicted domain
    const domainDtus = [];
    for (const [, dtu] of STATE.dtus || new Map()) {
      if (dtu.tier === "shadow") continue;
      const domain = extractDomainTag(dtu.tags || []);
      if (domain === predictedDomain) domainDtus.push(dtu);
    }

    if (domainDtus.length === 0) {
      gateResults.predictiveVerification.passed = true;
      gateResults.predictiveVerification.status = "unfalsified_pending";
      gateResults.predictiveVerification.reason = `No DTUs in domain "${predictedDomain}" to check against`;
    } else {
      // Check if prediction contradicts validated knowledge in that domain
      const predTokens = tokenize(prediction);
      let contradicted = false;
      for (const dtu of domainDtus) {
        for (const inv of (dtu.core?.invariants || [])) {
          const invTokens = tokenize(inv);
          const overlap = jaccardSimilarity(predTokens, invTokens);
          if (overlap > 0.4 && containsNegation(prediction, inv)) {
            contradicted = true;
            gateResults.predictiveVerification.reason = `Contradicts validated knowledge: "${inv.slice(0, 100)}"`;
            break;
          }
        }
        if (contradicted) break;
      }

      if (contradicted) {
        gateResults.predictiveVerification.passed = false;
        gateResults.predictiveVerification.status = "contradicted";
      } else {
        gateResults.predictiveVerification.passed = true;
        gateResults.predictiveVerification.status = "consistent";
        gateResults.predictiveVerification.reason = `Consistent with ${domainDtus.length} DTUs in domain "${predictedDomain}"`;
      }
    }
  } else {
    gateResults.predictiveVerification.passed = true;
    gateResults.predictiveVerification.status = "no_prediction";
    gateResults.predictiveVerification.reason = "No prediction to verify";
  }

  // ── Gate 3: Non-triviality ──
  let maxSimilarity = 0;
  let mostSimilarSource = null;

  for (const inv of sourceInvariants) {
    const invText = typeof inv === "string" ? inv : inv.invariant;
    if (!invText) continue;
    const sim = jaccardSimilarity(metaTokens, tokenize(invText));
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      mostSimilarSource = invText;
    }
  }

  gateResults.nonTriviality.maxSimilarity = maxSimilarity;
  if (maxSimilarity >= JACCARD_TRIVIALITY_THRESHOLD) {
    gateResults.nonTriviality.passed = false;
    gateResults.nonTriviality.reason = `Trivial restatement (Jaccard ${maxSimilarity.toFixed(3)} >= ${JACCARD_TRIVIALITY_THRESHOLD}) of: "${(mostSimilarSource || "").slice(0, 100)}"`;
  } else {
    gateResults.nonTriviality.passed = true;
    gateResults.nonTriviality.reason = `Sufficiently novel (max Jaccard ${maxSimilarity.toFixed(3)})`;
  }

  const allPassed = gateResults.selfConsistency.passed &&
                    gateResults.predictiveVerification.passed &&
                    gateResults.nonTriviality.passed;

  const store = getMetaStore(STATE);
  if (allPassed) store.metrics.candidatesValidated++;
  else store.metrics.candidatesRejected++;

  return { ok: true, passed: allPassed, gateResults };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. COMMIT META-INVARIANT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Commit a validated meta-invariant as a DTU through the standard pipeline.
 *
 * @param {Object} STATE
 * @param {Object} validated
 * @param {string} validated.metaInvariant
 * @param {string} validated.prediction
 * @param {string} validated.predictedDomain
 * @param {string} validated.reasoning
 * @param {Array} validated.sourceInvariants
 * @param {Array} validated.sourceDtuIds
 * @param {Array} validated.sourceDomains
 * @param {number} validated.distanceScore
 * @param {string} validated.verificationStatus
 * @param {Object} opts
 * @param {Function} opts.upsertDTU - The DTU upsert function
 * @param {Function} opts.uid - ID generator
 * @param {Function} [opts.realtimeEmit] - For lattice events
 * @returns {{ ok, dtu, needCreated, edgesCreated }}
 */
export function commitMetaInvariant(STATE, validated, opts = {}) {
  const store = getMetaStore(STATE);
  const { upsertDTU, uid } = opts;

  if (!upsertDTU || !uid) {
    return { ok: false, error: "upsertDTU_and_uid_required" };
  }

  // Check daily cap
  if (store.metaDtusToday >= MAX_META_DTUS_PER_DAY) {
    return { ok: false, error: "daily_meta_dtu_cap_reached", cap: MAX_META_DTUS_PER_DAY };
  }

  const domainList = (validated.sourceDomains || []).join("+");
  const dtuId = uid("meta");
  const now = new Date().toISOString();

  const dtu = {
    id: dtuId,
    title: `Meta-Invariant: ${(validated.metaInvariant || "").slice(0, 120)}`,
    content: validated.metaInvariant,
    tier: "mega",
    tags: [
      "meta-derivation", "meta-invariant",
      `domains:${domainList}`,
      ...(validated.sourceDomains || []).map(d => `domain:${d}`),
    ],
    source: "meta-derivation.cycle",
    machine: {
      kind: "meta_derivation",
      sourceInvariants: (validated.sourceInvariants || []).map(i =>
        typeof i === "string" ? i : i.invariant
      ),
      sourceDtuIds: validated.sourceDtuIds || [],
      sourceDomains: validated.sourceDomains || [],
      distanceScore: validated.distanceScore || 0,
      convergenceScore: 1.0 - (validated.distanceScore ? 1 / (validated.distanceScore + 1) : 0),
    },
    core: {
      definitions: [validated.metaInvariant],
      invariants: [validated.metaInvariant],
      claims: validated.prediction ? [validated.prediction] : [],
      examples: [],
      nextActions: validated.prediction && validated.verificationStatus === "unfalsified_pending"
        ? [`Verify prediction in domain "${validated.predictedDomain}": ${validated.prediction}`]
        : [],
    },
    human: { reasoning: validated.reasoning },
    confidence: 0.6, // meta-invariants start at moderate confidence
    createdAt: now,
    updatedAt: now,
  };

  upsertDTU(dtu);
  store.metaDtusToday++;
  store.committed.set(dtuId, {
    dtuId,
    metaInvariant: validated.metaInvariant,
    sourceDomains: validated.sourceDomains,
    createdAt: now,
  });

  // Create edges: meta-invariant --derives--> each source DTU
  let edgesCreated = 0;
  for (const sourceId of (validated.sourceDtuIds || [])) {
    try {
      createEdge(STATE, {
        sourceId: dtuId,
        targetId: sourceId,
        edgeType: "derives",
        weight: 0.8,
        provenance: { source: "meta-derivation", role: "source_invariant" },
      });
      edgesCreated++;
    } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
  }

  // If prediction targets an existing domain, create predicts edges
  if (validated.predictedDomain) {
    for (const [, existingDtu] of STATE.dtus) {
      if (existingDtu.tier === "shadow") continue;
      const domain = extractDomainTag(existingDtu.tags || []);
      if (domain === validated.predictedDomain) {
        try {
          createEdge(STATE, {
            sourceId: dtuId,
            targetId: existingDtu.id,
            edgeType: "references",
            weight: 0.5,
            provenance: { source: "meta-derivation", role: "prediction_target" },
          });
          edgesCreated++;
        } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
        if (edgesCreated > 20) break; // cap edge creation
      }
    }
  }

  // If prediction is unfalsified_pending, create a lattice need
  let needCreated = false;
  if (validated.verificationStatus === "unfalsified_pending" && validated.prediction) {
    const predictionId = uid("mpred");
    store.pendingPredictions.set(predictionId, {
      predictionId,
      metaDtuId: dtuId,
      prediction: validated.prediction,
      predictedDomain: validated.predictedDomain,
      status: "pending",
      createdAt: now,
    });

    try {
      recordNeed(STATE, {
        type: "meta_prediction_verification",
        priority: 0.8,
        matchingRoles: ["critic", "researcher", "validator"],
        description: `Meta-invariant [${dtuId}] predicts "${validated.prediction}" about ${validated.predictedDomain}. Needs empirical verification.`,
      });
      needCreated = true;
    } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
  }

  // Emit lattice event
  if (opts.realtimeEmit) {
    try {
      opts.realtimeEmit("lattice:meta:derived", {
        dtuId,
        metaInvariant: (validated.metaInvariant || "").slice(0, 200),
        sourceDomains: validated.sourceDomains,
        predictedDomain: validated.predictedDomain,
        sectorId: 7, // deep consciousness
      });
    } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
  }

  return { ok: true, dtu, needCreated, edgesCreated };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. INGEST DREAM INPUT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process a founder's sleep derivation.
 *
 * @param {Object} STATE
 * @param {string} rawText - The dream/voice-memo text
 * @param {string} [capturedAt] - When it was captured (ISO)
 * @param {Object} opts
 * @param {Function} opts.upsertDTU
 * @param {Function} opts.uid
 * @returns {{ ok, dtu }}
 */
export function ingestDreamInput(STATE, rawText, capturedAt, opts = {}) {
  if (!rawText || typeof rawText !== "string" || rawText.length < 10) {
    return { ok: false, error: "text_required_min_10_chars" };
  }
  const { upsertDTU, uid } = opts;
  if (!upsertDTU || !uid) {
    return { ok: false, error: "upsertDTU_and_uid_required" };
  }

  const store = getMetaStore(STATE);
  const now = new Date().toISOString();
  const dtuId = uid("dream");

  const dtu = {
    id: dtuId,
    title: `Dream Input: ${rawText.slice(0, 100)}`,
    content: rawText,
    tier: "mega",
    tags: ["dream-input", "meta-derivation", "source:founder"],
    source: "meta-derivation.dreamInput",
    machine: {
      kind: "dream_input",
      capturedAt: capturedAt || now,
      rawTranscript: rawText,
    },
    core: {
      definitions: [],
      invariants: [],
      claims: [],
      examples: [],
      nextActions: ["Extract invariants", "Run validation gates", "Check for convergence"],
    },
    confidence: 0.5,
    createdAt: now,
    updatedAt: now,
  };

  upsertDTU(dtu);

  store.dreamInputs.set(dtuId, {
    dtuId,
    rawText: rawText.slice(0, 5000),
    capturedAt: capturedAt || now,
    ingestedAt: now,
    convergenceChecked: false,
  });
  store.metrics.dreamInputsIngested++;

  return { ok: true, dtu };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. CONVERGENCE CHECK
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Find where dream inputs and lattice meta-derivations independently
 * arrived at the same truth.
 *
 * @param {Object} STATE
 * @param {Object} [opts]
 * @param {Function} [opts.upsertDTU]
 * @param {Function} [opts.uid]
 * @param {Function} [opts.realtimeEmit]
 * @returns {{ ok, convergences }}
 */
export function runConvergenceCheck(STATE, opts = {}) {
  const store = getMetaStore(STATE);
  const { upsertDTU, uid, realtimeEmit } = opts;

  // Get all dream-input DTUs
  const dreamDtus = [];
  for (const [, dtu] of STATE.dtus || new Map()) {
    if ((dtu.tags || []).includes("dream-input")) dreamDtus.push(dtu);
  }

  // Get all meta-derivation DTUs
  const metaDtus = [];
  for (const [, dtu] of STATE.dtus || new Map()) {
    if (dtu.machine?.kind === "meta_derivation") metaDtus.push(dtu);
  }

  if (dreamDtus.length === 0 || metaDtus.length === 0) {
    return { ok: true, convergences: [], reason: "insufficient_data" };
  }

  const newConvergences = [];

  for (const dreamDtu of dreamDtus) {
    const dreamTokens = tokenize(`${dreamDtu.content || ""} ${(dreamDtu.core?.invariants || []).join(" ")}`);

    for (const metaDtu of metaDtus) {
      // Skip if one was derived from the other
      const metaSourceIds = metaDtu.machine?.sourceDtuIds || [];
      if (metaSourceIds.includes(dreamDtu.id)) continue;

      const metaTokens = tokenize(`${metaDtu.content || ""} ${(metaDtu.core?.invariants || []).join(" ")}`);
      const similarity = jaccardSimilarity(dreamTokens, metaTokens);

      if (similarity < CONVERGENCE_SIMILARITY_THRESHOLD) continue;

      // Verify independent creation (different time windows, different sessions)
      const dreamTime = new Date(dreamDtu.createdAt).getTime();
      const metaTime = new Date(metaDtu.createdAt).getTime();
      const timeDiff = Math.abs(dreamTime - metaTime);
      if (timeDiff < 3600_000) continue; // less than 1 hour apart, might not be independent

      // Check we haven't already found this convergence
      const convKey = `${dreamDtu.id}|${metaDtu.id}`;
      if (store.convergences.has(convKey)) continue;

      // This is a real convergence
      const convergence = {
        convergenceId: convKey,
        dreamDtuId: dreamDtu.id,
        metaDtuId: metaDtu.id,
        similarity,
        dreamCreatedAt: dreamDtu.createdAt,
        metaCreatedAt: metaDtu.createdAt,
        discoveredAt: new Date().toISOString(),
      };

      store.convergences.set(convKey, convergence);
      store.metrics.convergencesFound++;
      newConvergences.push(convergence);

      // Create hyper-tier convergence DTU if we have the tools
      if (upsertDTU && uid) {
        const convDtuId = uid("conv");
        const convDtu = {
          id: convDtuId,
          title: `Convergence: "${(dreamDtu.content || "").slice(0, 60)}" ↔ "${(metaDtu.content || "").slice(0, 60)}"`,
          content: `Independent convergence between human intuition and computational derivation. Similarity: ${similarity.toFixed(3)}.`,
          tier: "hyper",
          tags: ["convergence", "meta-derivation", "dream-input", "verified"],
          source: "meta-derivation.convergence",
          machine: {
            kind: "independent_convergence",
            dreamDtuId: dreamDtu.id,
            metaDtuId: metaDtu.id,
            similarity,
          },
          core: {
            definitions: [dreamDtu.content, metaDtu.content].filter(Boolean),
            invariants: [
              ...(dreamDtu.core?.invariants || []),
              ...(metaDtu.core?.invariants || []),
            ],
            claims: ["Independent convergence from human intuition and computational derivation validates this constraint geometry"],
            examples: [],
            nextActions: [],
          },
          confidence: 0.9, // hyper-tier, independently verified
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        upsertDTU(convDtu);
        convergence.convergenceDtuId = convDtuId;

        // Create edges
        try {
          createEdge(STATE, { sourceId: convDtuId, targetId: dreamDtu.id, edgeType: "derives", weight: 1.0,
            provenance: { source: "convergence", role: "dream_input" } });
          createEdge(STATE, { sourceId: convDtuId, targetId: metaDtu.id, edgeType: "derives", weight: 1.0,
            provenance: { source: "convergence", role: "meta_derivation" } });
        } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
      }

      // Emit lattice event
      if (realtimeEmit) {
        try {
          realtimeEmit("lattice:meta:convergence", {
            convergenceId: convKey,
            dreamDtuId: dreamDtu.id,
            metaDtuId: metaDtu.id,
            similarity,
            sectorId: 7,
          });
        } catch (_e) { logger.debug('emergent:meta-derivation', 'silent catch', { error: _e?.message }); }
      }
    }
  }

  store.lastConvergenceAt = new Date().toISOString();

  return { ok: true, convergences: newConvergences, count: newConvergences.length };
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL CYCLE ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Run a full meta-derivation cycle:
 *   1. Extract invariant pool
 *   2. Select up to 3 maximally distant sets
 *   3. Generate sessions (prompts returned for LLM execution by caller)
 *
 * @param {Object} STATE
 * @returns {{ ok, sessions, poolStats }}
 */
export function triggerMetaDerivationCycle(STATE) {
  const store = getMetaStore(STATE);

  if (store.cycleInProgress) {
    return { ok: false, error: "cycle_already_in_progress" };
  }

  if (store.metaDtusToday >= MAX_META_DTUS_PER_DAY) {
    return { ok: false, error: "daily_cap_reached", cap: MAX_META_DTUS_PER_DAY };
  }

  // 1. Extract pool
  const poolResult = extractInvariantPool(STATE);
  if (!poolResult.ok) return poolResult;

  store.cycleInProgress = true;
  store.metrics.cyclesRun++;

  // 2. Generate up to MAX_SESSIONS_PER_CYCLE sessions
  const sessions = [];
  const usedDomainSets = new Set();

  for (let i = 0; i < MAX_SESSIONS_PER_CYCLE; i++) {
    const setResult = selectMaximallyDistantSet(STATE, poolResult.pool, 5);
    if (!setResult.ok) break;

    // Avoid duplicate domain sets
    const setKey = setResult.selectedDomains.sort().join("|");
    if (usedDomainSets.has(setKey)) break;
    usedDomainSets.add(setKey);

    const sessionResult = runMetaDerivationSession(STATE, setResult.set);
    if (sessionResult.ok) {
      sessions.push({
        ...sessionResult,
        distanceMatrix: setResult.distanceMatrix,
      });
    }
  }

  store.cycleInProgress = false;
  store.lastCycleAt = new Date().toISOString();
  store.metrics.candidatesGenerated += sessions.length;

  return {
    ok: true,
    sessions,
    sessionCount: sessions.length,
    poolStats: {
      domainCount: poolResult.domainCount,
      invariantCount: poolResult.invariantCount,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULING GUARDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if meta-derivation cycle should run (for scheduler integration).
 */
export function shouldRunMetaCycle(STATE) {
  const store = getMetaStore(STATE);

  if (store.cycleInProgress) return false;
  if (store.metaDtusToday >= MAX_META_DTUS_PER_DAY) return false;
  if (!STATE.dtus || STATE.dtus.size < MIN_DTUS_FOR_META) return false;

  if (store.lastCycleAt) {
    const elapsed = Date.now() - new Date(store.lastCycleAt).getTime();
    if (elapsed < META_DERIVATION_INTERVAL_MS) return false;
  }

  return true;
}

/**
 * Check if convergence check should run.
 */
export function shouldRunConvergenceCheck(STATE) {
  const store = getMetaStore(STATE);

  if (store.dreamInputs.size === 0) return false;
  if (store.lastConvergenceAt) {
    const elapsed = Date.now() - new Date(store.lastConvergenceAt).getTime();
    if (elapsed < CONVERGENCE_INTERVAL_MS) return false;
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// QUERY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get all pending predictions awaiting verification.
 */
export function getPendingPredictions(STATE) {
  const store = getMetaStore(STATE);
  return {
    ok: true,
    predictions: Array.from(store.pendingPredictions.values()).filter(p => p.status === "pending"),
    count: store.pendingPredictions.size,
  };
}

/**
 * Get all convergence events.
 */
export function getConvergences(STATE) {
  const store = getMetaStore(STATE);
  return {
    ok: true,
    convergences: Array.from(store.convergences.values()),
    count: store.convergences.size,
  };
}

/**
 * Get all committed meta-invariants.
 */
export function getMetaInvariants(STATE) {
  const store = getMetaStore(STATE);
  return {
    ok: true,
    invariants: Array.from(store.committed.values()),
    count: store.committed.size,
  };
}

/**
 * Get meta-derivation metrics.
 */
export function getMetaDerivationMetrics(STATE) {
  const store = getMetaStore(STATE);
  return {
    ok: true,
    lastCycleAt: store.lastCycleAt,
    lastConvergenceAt: store.lastConvergenceAt,
    metaDtusToday: store.metaDtusToday,
    dailyCap: MAX_META_DTUS_PER_DAY,
    committedCount: store.committed.size,
    dreamInputCount: store.dreamInputs.size,
    convergenceCount: store.convergences.size,
    pendingPredictions: store.pendingPredictions.size,
    cycleIntervalMs: META_DERIVATION_INTERVAL_MS,
    ...store.metrics,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenize text for Jaccard similarity.
 */
function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Simple negation detection between two texts.
 */
function containsNegation(textA, textB) {
  const negPatterns = ["not ", "never ", "no ", "cannot ", "impossible ", "false ", "incorrect "];
  const aLower = textA.toLowerCase();
  const bLower = textB.toLowerCase();

  for (const neg of negPatterns) {
    if (aLower.includes(neg) && !bLower.includes(neg)) return true;
    if (bLower.includes(neg) && !aLower.includes(neg)) return true;
  }
  return false;
}
