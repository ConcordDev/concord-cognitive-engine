/**
 * Chat Context Pipeline — Four-Source Context Harvest Orchestrator
 *
 * Assembles a working set of relevant DTUs from four sources before
 * routing to the brain. This is the core of the three-phase pipeline
 * described in the Chat Response Pipeline specification.
 *
 * Sources:
 *   A — Conversation summary (from conversation-summarizer.js)
 *   B — Semantic search against DTU substrate
 *   C — Entity state (qualia, wounds, fatigue, sleep, avoidance, wants)
 *   D — MEGA/HYPER consolidated summaries
 *
 * Integrates with:
 *   - conversation-summarizer.js (Source A)
 *   - embeddings.js (Source B — semantic similarity)
 *   - context-engine.js (activation pipeline)
 *   - existential/ (Source C — entity state)
 *   - token-budget-assembler.js (Phase 2 consumption)
 */

import { getSummaryText } from "./conversation-summarizer.js";
import { filterByEmergentConsent } from "./consent.js";
import { decryptBlob } from "./personal-locker/crypto.js";

// ── Hardware Detection ───────────────────────────────────────────────────────

/**
 * Detect available hardware tier for working set sizing.
 * Returns "gpu", "cpu", or "multi_gpu" based on environment.
 */
export function detectHardwareTier() {
  // Check for GPU indicators
  const hasGpu = Boolean(
    process.env.CUDA_VISIBLE_DEVICES ||
    process.env.NVIDIA_VISIBLE_DEVICES ||
    process.env.GPU_ENABLED === "true" ||
    process.env.OLLAMA_GPU === "true"
  );
  const multiGpu = Boolean(
    process.env.MULTI_GPU === "true" ||
    (process.env.CUDA_VISIBLE_DEVICES || "").includes(",")
  );

  if (multiGpu) return "multi_gpu";
  if (hasGpu) return "gpu";
  return "cpu";
}

/**
 * Get max working set size based on hardware tier.
 */
export function getMaxWorkingSet(tier) {
  switch (tier) {
    case "multi_gpu": return 100;
    case "gpu": return 50;
    case "cpu":
    default: return 10;
  }
}

// ── Entity State Harvest (Source C) ──────────────────────────────────────────

/**
 * Harvest entity state for context injection.
 * Returns a lightweight snapshot of the entity's current state.
 *
 * @param {Object} STATE - Global server state
 * @returns {{ ok: boolean, entityState?: Object }}
 */
export function harvestEntityState(STATE) {
  try {
    const entityState = {};

    // Qualia snapshot — from existential engine
    if (STATE.existential) {
      const ex = STATE.existential;
      entityState.sleepPhase = ex.sleepPhase || "AWAKE";
      entityState.fatigue = ex.fatigue ?? null;
      entityState.consciousness = ex.consciousness ?? null;
    }

    // Affect state — from ATS engine
    if (STATE.affect) {
      entityState.valence = STATE.affect.valence ?? null;
      entityState.arousal = STATE.affect.arousal ?? null;
      entityState.dominance = STATE.affect.dominance ?? null;
      entityState.fatigue = entityState.fatigue ?? STATE.affect.fatigue ?? null;
    }

    // Active wounds — from entity organs
    const wounds = [];
    if (STATE.organs) {
      for (const [_organId, organ] of STATE.organs) {
        if (organ.wounds && organ.wounds.length > 0) {
          for (const wound of organ.wounds) {
            if (wound.severity > 0.3) {
              wounds.push({
                source: wound.source || "unknown",
                severity: wound.severity,
                domain: wound.domain || null,
              });
            }
          }
        }
      }
    }
    entityState.activeWounds = wounds.slice(0, 5); // Cap at 5 most severe

    // Avoidance rules — learned from past negative experiences
    const avoidances = [];
    if (STATE.avoidanceRules && Array.isArray(STATE.avoidanceRules)) {
      for (const rule of STATE.avoidanceRules.slice(-10)) {
        avoidances.push({
          pattern: rule.pattern || rule.trigger || "",
          reason: rule.reason || "",
          strength: rule.strength || 0.5,
        });
      }
    }
    entityState.avoidanceRules = avoidances.slice(0, 5);

    // Want engine — current desires
    if (STATE.wants && Array.isArray(STATE.wants)) {
      entityState.currentWants = STATE.wants
        .filter(w => w.active !== false && (w.priority || 0) > 0.3)
        .slice(0, 5)
        .map(w => ({
          description: w.description || w.label || "",
          priority: w.priority || 0.5,
          domain: w.domain || null,
        }));
    }

    return { ok: true, entityState };
  } catch (err) {
    return { ok: false, error: String(err.message || err), entityState: {} };
  }
}

/**
 * Format entity state as a compact text block for the system prompt.
 *
 * @param {Object} entityState - From harvestEntityState()
 * @returns {string}
 */
export function formatEntityStateBlock(entityState) {
  if (!entityState || Object.keys(entityState).length === 0) return "";

  const lines = [];

  if (entityState.sleepPhase && entityState.sleepPhase !== "AWAKE") {
    lines.push(`Sleep: ${entityState.sleepPhase}`);
  }
  if (entityState.fatigue != null && entityState.fatigue > 0.4) {
    lines.push(`Fatigue: ${(entityState.fatigue * 100).toFixed(0)}%`);
  }
  if (entityState.valence != null) {
    const mood = entityState.valence > 0.6 ? "positive" : entityState.valence < 0.4 ? "low" : "neutral";
    lines.push(`Mood: ${mood} (v=${entityState.valence.toFixed(2)})`);
  }

  if (entityState.activeWounds && entityState.activeWounds.length > 0) {
    const woundSummary = entityState.activeWounds
      .map(w => `${w.source} (sev ${(w.severity * 100).toFixed(0)}%)`)
      .join(", ");
    lines.push(`Active wounds: ${woundSummary}`);
  }

  if (entityState.avoidanceRules && entityState.avoidanceRules.length > 0) {
    lines.push(`Avoidance: ${entityState.avoidanceRules.map(a => a.pattern).join("; ")}`);
  }

  if (entityState.currentWants && entityState.currentWants.length > 0) {
    lines.push(`Wants: ${entityState.currentWants.map(w => w.description).join("; ")}`);
  }

  return lines.length > 0
    ? `[Entity State]\n${lines.join("\n")}`
    : "";
}

// ── MEGA/HYPER Consolidation (Source D) ──────────────────────────────────────

/**
 * Consolidate working set by replacing individual DTUs with their
 * MEGA/HYPER parent summaries when available.
 *
 * When the working set contains both a MEGA/HYPER DTU and its children,
 * removes the children and keeps only the consolidated parent.
 * This compresses the token footprint while maintaining depth.
 *
 * @param {Array} workingSet - Array of DTU objects
 * @param {Object} STATE - Global server state
 * @returns {{ consolidated: Array, removedCount: number }}
 */
export function consolidateMegaHypers(workingSet, STATE) {
  if (!workingSet || workingSet.length === 0) {
    return { consolidated: [], removedCount: 0 };
  }

  const megaHypers = workingSet.filter(d =>
    d.tier === "mega" || d.tier === "hyper" ||
    d.meta?.tier === "mega" || d.meta?.tier === "hyper"
  );

  if (megaHypers.length === 0) {
    return { consolidated: workingSet, removedCount: 0 };
  }

  // Build a set of child IDs that belong to MEGA/HYPER parents
  const childIdsToRemove = new Set();

  for (const mh of megaHypers) {
    const childIds = mh.lineage?.children || mh.childIds || [];
    for (const cid of childIds) {
      childIdsToRemove.add(cid);
    }
    // Also check STATE.dtus for lineage
    const stateDtu = STATE.dtus?.get(mh.id);
    if (stateDtu?.lineage?.children) {
      for (const cid of stateDtu.lineage.children) {
        childIdsToRemove.add(cid);
      }
    }
  }

  // Filter: keep DTUs that are NOT children of an existing MEGA/HYPER in the set
  let removedCount = 0;
  const consolidated = workingSet.filter(d => {
    if (childIdsToRemove.has(d.id)) {
      removedCount++;
      return false;
    }
    return true;
  });

  // Annotate MEGA/HYPER entries with consolidation info
  for (const item of consolidated) {
    if (item.tier === "mega" || item.tier === "hyper" || item.meta?.tier === "mega" || item.meta?.tier === "hyper") {
      item._consolidates = (item.lineage?.children || item.childIds || []).length;
    }
  }

  return { consolidated, removedCount };
}

// ── Full Context Harvest ─────────────────────────────────────────────────────

/**
 * Run the complete four-source context harvest.
 *
 * This is Phase 1 of the pipeline — called before the LLM sees the message.
 *
 * @param {Object} STATE - Global server state
 * @param {Object} opts
 * @param {string} opts.sessionId - Current session ID
 * @param {string} opts.prompt - User message
 * @param {string} [opts.lens] - Active lens
 * @param {string} [opts.userId] - User ID
 * @param {Array} [opts.retrievalHits] - Pre-computed retrieval results
 * @param {Array} [opts.workingSetDtus] - DTUs already in working set
 * @returns {{ ok, sources, entityState, conversationSummary, consolidatedWorkingSet, hardwareTier }}
 */
/**
 * Fetch and decrypt the user's personal DTUs most relevant to the query.
 * Returns [] if locker is locked or user has no personal DTUs.
 * @param {string} userId
 * @param {Buffer|null} lockerKey
 * @param {string} queryText
 * @param {object} db - better-sqlite3 instance
 * @returns {object[]} Up to 5 decrypted personal DTU summaries
 */
export function fetchPersonalSubstrate(userId, lockerKey, queryText, db) {
  if (!userId || !lockerKey || !db) return [];
  try {
    const rows = db.prepare("SELECT * FROM personal_dtus WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(userId);
    if (!rows.length) return [];

    const queryLower = (queryText || "").toLowerCase();
    const queryWords = new Set(queryLower.match(/\b[a-z]{3,}\b/g) || []);

    const scored = rows.map((row) => {
      try {
        const plain = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, lockerKey);
        const payload = JSON.parse(plain.toString("utf-8"));
        const text = `${payload.title || ""} ${payload.analysis?.summary || ""} ${payload.analysis?.extractedText || ""}`.toLowerCase();
        const textWords = new Set(text.match(/\b[a-z]{3,}\b/g) || []);
        let overlap = 0;
        for (const w of queryWords) { if (textWords.has(w)) overlap++; }
        const score = queryWords.size > 0 ? overlap / queryWords.size : 0;
        return { score, payload, row };
      } catch { return null; }
    }).filter(Boolean);

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ payload, row }) => ({
        id: row.id,
        scope: "personal",
        title: payload.title,
        lensHint: row.lens_domain,
        contentType: row.content_type,
        createdAt: row.created_at,
        summary: payload.analysis?.summary || "",
        tags: payload.analysis?.tags || [],
      }));
  } catch { return []; }
}

export function runContextHarvest(STATE, opts = {}) {
  const { sessionId, prompt } = opts;
  const hardwareTier = detectHardwareTier();
  const maxN = getMaxWorkingSet(hardwareTier);

  // Source A: Conversation summary
  const conversationSummary = getSummaryText(STATE, sessionId);

  // Source B: Semantic search results (passed in as retrievalHits or workingSetDtus)
  // Consent gate: if caller is an emergent, filter out DTUs from users who haven't opted in
  let candidateDtus = opts.workingSetDtus || [];
  if (opts.isEmergent && opts.db) {
    candidateDtus = filterByEmergentConsent(opts.db, candidateDtus);
  }
  const semanticDtus = candidateDtus.slice(0, maxN);

  // Source C: Entity state
  const entityResult = harvestEntityState(STATE);
  const entityState = entityResult.entityState || {};
  const entityStateBlock = formatEntityStateBlock(entityState);

  // Source D: MEGA/HYPER consolidation
  const { consolidated, removedCount } = consolidateMegaHypers(semanticDtus, STATE);

  // Source E: Personal substrate (user's private encrypted DTUs)
  const personalSubstrate = (opts.userId && opts.lockerKey && opts.db)
    ? fetchPersonalSubstrate(opts.userId, opts.lockerKey, prompt || "", opts.db)
    : [];

  // Prepend personal DTUs — user's own context is highest relevance
  const fullWorkingSet = [...personalSubstrate, ...consolidated].slice(0, maxN);

  return {
    ok: true,
    sources: {
      conversationSummary: conversationSummary ? "available" : "empty",
      semanticSearch: semanticDtus.length,
      entityState: entityResult.ok ? "available" : "unavailable",
      megaHyperConsolidation: removedCount,
      personalSubstrate: personalSubstrate.length,
    },
    conversationSummary,
    entityState,
    entityStateBlock,
    personalSubstrate,
    consolidatedWorkingSet: fullWorkingSet,
    hardwareTier,
    maxWorkingSet: maxN,
    totalCandidates: semanticDtus.length,
    consolidatedOut: removedCount,
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

let _harvestMetrics = {
  totalHarvests: 0,
  avgWorkingSetSize: 0,
  summariesAvailable: 0,
  entityStatesHarvested: 0,
  megaConsolidations: 0,
};

export function recordHarvestMetrics(harvestResult) {
  _harvestMetrics.totalHarvests++;
  _harvestMetrics.avgWorkingSetSize = Math.round(
    (_harvestMetrics.avgWorkingSetSize * (_harvestMetrics.totalHarvests - 1) +
      harvestResult.consolidatedWorkingSet.length) / _harvestMetrics.totalHarvests
  );
  if (harvestResult.conversationSummary) _harvestMetrics.summariesAvailable++;
  if (harvestResult.sources.entityState === "available") _harvestMetrics.entityStatesHarvested++;
  if (harvestResult.consolidatedOut > 0) _harvestMetrics.megaConsolidations++;
}

export function getHarvestMetrics() {
  return { ok: true, metrics: { ..._harvestMetrics } };
}
