/**
 * System 4: Hypothesis Engine — Formal Lifecycle for Testable Claims
 *
 * Manages hypothesis DTUs through a formal lifecycle:
 *   proposed → testing → confirmed → (can be overturned)
 *   proposed → testing → rejected → refined → testing again
 *   any state → archived
 *
 * Each hypothesis is a first-class DTU with structured evidence,
 * tests, predictions, and confidence tracking. Auto-transitions
 * move hypotheses through states based on evidence accumulation
 * and test results.
 *
 * Additive only. One file. Silent failure.
 */

import crypto from "crypto";
import logger from '../logger.js';
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

// ── Constants ───────────────────────────────────────────────────────────────

export const HYPOTHESIS_STATUSES = Object.freeze([
  "proposed",
  "testing",
  "confirmed",
  "rejected",
  "refined",
  "archived",
]);

// ── In-Memory State ─────────────────────────────────────────────────────────

const _hypotheses = new LruMap();   // id → hypothesis DTU
const _factDTUs = new LruMap();     // id → fact DTU (promoted from confirmed)
const _rejectionDTUs = new LruMap(); // id → rejection DTU

// ── Confidence Calculation ──────────────────────────────────────────────────

/**
 * Recalculate confidence for a hypothesis based on evidence, tests, and
 * predictions.
 *
 * Formula:
 *   forWeight = sum of evidence_for weights
 *   againstWeight = sum of evidence_against weights
 *   base = forWeight / (forWeight + againstWeight)
 *   testBonus = (passed_tests / total_tests) * 0.2
 *   predictionBonus = verified_predictions * 0.05
 *   predictionPenalty = falsified_predictions * 0.1
 *   confidence = clamp(base + testBonus + predictionBonus - predictionPenalty, 0, 1)
 *
 * @param {string} id - Hypothesis ID
 * @returns {{ ok: boolean, confidence?: number }}
 */
export function recalculateConfidence(id) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    const h = hyp.machine.hypothesis;

    const forWeight = (h.evidence_for || []).reduce((s, e) => s + (Number(e.weight) || 0), 0);
    const againstWeight = (h.evidence_against || []).reduce((s, e) => s + (Number(e.weight) || 0), 0);

    const totalWeight = forWeight + againstWeight;
    const base = totalWeight > 0 ? forWeight / totalWeight : 0.5;

    const totalTests = (h.tests || []).length;
    const passedTests = (h.tests || []).filter(t => t.status === "passed").length;
    const testBonus = totalTests > 0 ? (passedTests / totalTests) * 0.2 : 0;

    const verifiedPredictions = (h.predictions || []).filter(p => p.verified === true).length;
    const falsifiedPredictions = (h.predictions || []).filter(p => p.verified === false).length;
    const predictionBonus = verifiedPredictions * 0.05;
    const predictionPenalty = falsifiedPredictions * 0.1;

    const confidence = clamp01(base + testBonus + predictionBonus - predictionPenalty);
    h.confidence = Math.round(confidence * 1000) / 1000;

    return { ok: true, confidence: h.confidence };
  } catch {
    return { ok: false, error: "recalculation_failed" };
  }
}

// ── Auto-Transitions ────────────────────────────────────────────────────────

/**
 * Check and apply automatic state transitions for a hypothesis.
 *
 * Rules:
 *   - proposed → testing: when any evidence is added
 *   - testing → confirmed: when confidence >= 0.85 AND all tests passed
 *   - On confirmed: promote to fact DTU
 *   - On rejected: create rejection DTU with reasoning
 *   - On refined: create child hypothesis with modifications
 *
 * @param {string} id - Hypothesis ID
 * @returns {{ ok: boolean, transitioned?: boolean, from?: string, to?: string }}
 */
export function checkAutoTransitions(id) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    const h = hyp.machine.hypothesis;
    const oldStatus = h.status;

    // proposed → testing: when any evidence is added
    if (h.status === "proposed") {
      const hasEvidence = (h.evidence_for.length > 0 || h.evidence_against.length > 0);
      if (hasEvidence) {
        h.status = "testing";
        h.lifecycle.push({ event: "auto_transition", by: "system", at: nowISO(), note: "proposed → testing: evidence added" });
        return { ok: true, transitioned: true, from: oldStatus, to: "testing" };
      }
    }

    // testing → confirmed: when confidence >= 0.85 AND all tests passed
    if (h.status === "testing") {
      recalculateConfidence(id);
      const allTests = h.tests || [];
      const allPassed = allTests.length > 0 && allTests.every(t => t.status === "passed");
      if (h.confidence >= 0.85 && allPassed) {
        h.status = "confirmed";
        h.lifecycle.push({ event: "auto_transition", by: "system", at: nowISO(), note: "testing → confirmed: confidence >= 0.85 and all tests passed" });
        _promoteToFact(hyp);
        return { ok: true, transitioned: true, from: oldStatus, to: "confirmed" };
      }
    }

    return { ok: true, transitioned: false, from: oldStatus, to: oldStatus };
  } catch {
    return { ok: false, error: "transition_check_failed" };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Promote a confirmed hypothesis to a fact DTU.
 */
function _promoteToFact(hyp) {
  try {
    const h = hyp.machine.hypothesis;
    const factId = uid("fact");
    const factDTU = {
      id: factId,
      title: `Fact: ${h.statement}`,
      kind: "fact",
      sourceHypothesisId: hyp.id,
      statement: h.statement,
      confidence: h.confidence,
      domain: h.domain,
      evidence_for: [...h.evidence_for],
      evidence_against: [...h.evidence_against],
      tests: [...h.tests],
      predictions: [...h.predictions],
      promotedAt: nowISO(),
    };
    _factDTUs.set(factId, factDTU);
    h.lifecycle.push({ event: "promoted_to_fact", by: "system", at: nowISO(), note: `Fact DTU created: ${factId}` });
  } catch (_e) { logger.debug('emergent:hypothesis-engine', 'silent', { error: _e?.message }); }
}

/**
 * Create a rejection DTU with reasoning.
 */
function _createRejectionDTU(hyp, reason) {
  try {
    const h = hyp.machine.hypothesis;
    const rejId = uid("rejection");
    const rejDTU = {
      id: rejId,
      title: `Rejected: ${h.statement}`,
      kind: "rejection",
      sourceHypothesisId: hyp.id,
      statement: h.statement,
      reason: reason || "Manually rejected",
      confidence: h.confidence,
      domain: h.domain,
      evidence_for: [...h.evidence_for],
      evidence_against: [...h.evidence_against],
      rejectedAt: nowISO(),
    };
    _rejectionDTUs.set(rejId, rejDTU);
    h.lifecycle.push({ event: "rejection_dtu_created", by: "system", at: nowISO(), note: `Rejection DTU created: ${rejId}` });
  } catch (_e) { logger.debug('emergent:hypothesis-engine', 'silent', { error: _e?.message }); }
}

// ── Core CRUD ───────────────────────────────────────────────────────────────

/**
 * Propose a new hypothesis. Creates a hypothesis DTU in "proposed" state.
 *
 * @param {string} statement - Clear falsifiable claim
 * @param {string} [domain="general"] - Domain of the hypothesis
 * @param {string} [priority="normal"] - Priority level
 * @returns {{ ok: boolean, hypothesis?: object }}
 */
export function proposeHypothesis(statement, domain, priority) {
  try {
    if (!statement || typeof statement !== "string") {
      return { ok: false, error: "statement_required" };
    }

    const id = uid("hyp");
    const now = nowISO();

    const hyp = {
      id,
      createdAt: now,
      updatedAt: now,
      machine: {
        kind: "hypothesis",
        hypothesis: {
          statement: String(statement).slice(0, 2000),
          status: "proposed",
          confidence: 0.5,
          falsifiable: true,
          evidence_for: [],
          evidence_against: [],
          tests: [],
          predictions: [],
          lifecycle: [{ event: "proposed", by: "user", at: now, note: "Hypothesis created" }],
          parentHypothesis: null,
          childHypotheses: [],
          domain: domain || "general",
          priority: priority || "normal",
        },
      },
    };

    _hypotheses.set(id, hyp);
    return { ok: true, hypothesis: hyp };
  } catch {
    return { ok: false, error: "proposal_failed" };
  }
}

/**
 * Get a hypothesis by ID.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getHypothesis(id) {
  try {
    return _hypotheses.get(id) || null;
  } catch {
    return null;
  }
}

/**
 * List hypotheses, optionally filtered by status.
 *
 * @param {string} [status] - Filter by status
 * @returns {object[]}
 */
export function listHypotheses(status) {
  try {
    const results = [];
    for (const hyp of _hypotheses.values()) {
      if (status && hyp.machine.hypothesis.status !== status) continue;
      results.push(hyp);
    }
    return results;
  } catch {
    return [];
  }
}

// ── Evidence Management ─────────────────────────────────────────────────────

/**
 * Add evidence to a hypothesis.
 *
 * @param {string} hypothesisId
 * @param {string} side - "for" or "against"
 * @param {string} dtuId - ID of the evidence DTU
 * @param {number} weight - Evidence weight (0-1)
 * @param {string} summary - Brief summary
 * @returns {{ ok: boolean }}
 */
export function addEvidence(hypothesisId, side, dtuId, weight, summary) {
  try {
    const hyp = _hypotheses.get(hypothesisId);
    if (!hyp) return { ok: false, error: "not_found" };

    if (side !== "for" && side !== "against") {
      return { ok: false, error: "side_must_be_for_or_against" };
    }

    const entry = {
      dtuId: dtuId || uid("ev"),
      weight: clamp01(weight),
      summary: String(summary || "").slice(0, 500),
    };

    const h = hyp.machine.hypothesis;
    if (side === "for") {
      h.evidence_for.push(entry);
    } else {
      h.evidence_against.push(entry);
    }

    h.lifecycle.push({
      event: "evidence_added",
      by: "user",
      at: nowISO(),
      note: `Evidence ${side}: ${entry.summary.slice(0, 80)}`,
    });

    hyp.updatedAt = nowISO();
    recalculateConfidence(hypothesisId);
    checkAutoTransitions(hypothesisId);

    return { ok: true };
  } catch {
    return { ok: false, error: "add_evidence_failed" };
  }
}

// ── Test Management ─────────────────────────────────────────────────────────

/**
 * Add a test to a hypothesis.
 *
 * @param {string} hypothesisId
 * @param {string} description - Test description
 * @returns {{ ok: boolean, testId?: string }}
 */
export function addTest(hypothesisId, description) {
  try {
    const hyp = _hypotheses.get(hypothesisId);
    if (!hyp) return { ok: false, error: "not_found" };

    const testId = uid("test");
    const test = {
      id: testId,
      description: String(description || "").slice(0, 1000),
      status: "pending",
      result: null,
    };

    hyp.machine.hypothesis.tests.push(test);
    hyp.machine.hypothesis.lifecycle.push({
      event: "test_added",
      by: "user",
      at: nowISO(),
      note: `Test added: ${test.description.slice(0, 80)}`,
    });

    hyp.updatedAt = nowISO();
    return { ok: true, testId };
  } catch {
    return { ok: false, error: "add_test_failed" };
  }
}

/**
 * Update the result of a test.
 *
 * @param {string} hypothesisId
 * @param {string} testId
 * @param {string} result - "passed", "failed", or "inconclusive"
 * @returns {{ ok: boolean }}
 */
export function updateTestResult(hypothesisId, testId, result) {
  try {
    const hyp = _hypotheses.get(hypothesisId);
    if (!hyp) return { ok: false, error: "not_found" };

    const validResults = ["passed", "failed", "inconclusive"];
    if (!validResults.includes(result)) {
      return { ok: false, error: "invalid_result", allowed: validResults };
    }

    const test = hyp.machine.hypothesis.tests.find(t => t.id === testId);
    if (!test) return { ok: false, error: "test_not_found" };

    test.status = result;
    test.result = result;

    hyp.machine.hypothesis.lifecycle.push({
      event: "test_updated",
      by: "user",
      at: nowISO(),
      note: `Test ${testId} result: ${result}`,
    });

    hyp.updatedAt = nowISO();
    recalculateConfidence(hypothesisId);
    checkAutoTransitions(hypothesisId);

    return { ok: true };
  } catch {
    return { ok: false, error: "update_test_failed" };
  }
}

// ── Prediction Management ───────────────────────────────────────────────────

/**
 * Add a prediction to a hypothesis.
 *
 * @param {string} hypothesisId
 * @param {string} statement - Prediction statement
 * @returns {{ ok: boolean, predIndex?: number }}
 */
export function addPrediction(hypothesisId, statement) {
  try {
    const hyp = _hypotheses.get(hypothesisId);
    if (!hyp) return { ok: false, error: "not_found" };

    const prediction = {
      statement: String(statement || "").slice(0, 1000),
      verified: null,
    };

    hyp.machine.hypothesis.predictions.push(prediction);
    const predIndex = hyp.machine.hypothesis.predictions.length - 1;

    hyp.machine.hypothesis.lifecycle.push({
      event: "prediction_added",
      by: "user",
      at: nowISO(),
      note: `Prediction added: ${prediction.statement.slice(0, 80)}`,
    });

    hyp.updatedAt = nowISO();
    return { ok: true, predIndex };
  } catch {
    return { ok: false, error: "add_prediction_failed" };
  }
}

/**
 * Verify or falsify a prediction.
 *
 * @param {string} hypothesisId
 * @param {number} predIndex - Index of the prediction
 * @param {boolean} verified - true if verified, false if falsified
 * @returns {{ ok: boolean }}
 */
export function verifyPrediction(hypothesisId, predIndex, verified) {
  try {
    const hyp = _hypotheses.get(hypothesisId);
    if (!hyp) return { ok: false, error: "not_found" };

    const predictions = hyp.machine.hypothesis.predictions;
    if (predIndex < 0 || predIndex >= predictions.length) {
      return { ok: false, error: "invalid_prediction_index" };
    }

    predictions[predIndex].verified = Boolean(verified);

    hyp.machine.hypothesis.lifecycle.push({
      event: "prediction_verified",
      by: "user",
      at: nowISO(),
      note: `Prediction ${predIndex} ${verified ? "verified" : "falsified"}`,
    });

    hyp.updatedAt = nowISO();
    recalculateConfidence(hypothesisId);
    checkAutoTransitions(hypothesisId);

    return { ok: true };
  } catch {
    return { ok: false, error: "verify_prediction_failed" };
  }
}

// ── Lifecycle Transitions ───────────────────────────────────────────────────

/**
 * Manually confirm a hypothesis. Promotes to fact DTU.
 *
 * @param {string} id
 * @returns {{ ok: boolean }}
 */
export function confirmHypothesis(id) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    const h = hyp.machine.hypothesis;
    h.status = "confirmed";
    h.lifecycle.push({ event: "confirmed", by: "user", at: nowISO(), note: "Manually confirmed" });
    hyp.updatedAt = nowISO();

    _promoteToFact(hyp);

    return { ok: true };
  } catch {
    return { ok: false, error: "confirm_failed" };
  }
}

/**
 * Manually reject a hypothesis. Creates rejection DTU.
 *
 * @param {string} id
 * @param {string} reason - Rejection reasoning
 * @returns {{ ok: boolean }}
 */
export function rejectHypothesis(id, reason) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    const h = hyp.machine.hypothesis;
    h.status = "rejected";
    h.lifecycle.push({ event: "rejected", by: "user", at: nowISO(), note: reason || "Manually rejected" });
    hyp.updatedAt = nowISO();

    _createRejectionDTU(hyp, reason);

    return { ok: true };
  } catch {
    return { ok: false, error: "reject_failed" };
  }
}

/**
 * Refine a hypothesis. Sets current to "refined" and creates a child
 * hypothesis with the new statement.
 *
 * @param {string} id
 * @param {string} newStatement - Refined statement
 * @returns {{ ok: boolean, childId?: string }}
 */
export function refineHypothesis(id, newStatement) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    if (!newStatement || typeof newStatement !== "string") {
      return { ok: false, error: "new_statement_required" };
    }

    const h = hyp.machine.hypothesis;
    h.status = "refined";
    h.lifecycle.push({ event: "refined", by: "user", at: nowISO(), note: `Refined into new hypothesis` });
    hyp.updatedAt = nowISO();

    // Create child hypothesis
    const childResult = proposeHypothesis(newStatement, h.domain, h.priority);
    if (!childResult.ok) return { ok: false, error: "child_creation_failed" };

    const child = childResult.hypothesis;
    child.machine.hypothesis.parentHypothesis = id;
    child.machine.hypothesis.lifecycle.push({
      event: "refined_from_parent",
      by: "system",
      at: nowISO(),
      note: `Refined from ${id}`,
    });

    h.childHypotheses.push(child.id);

    return { ok: true, childId: child.id };
  } catch {
    return { ok: false, error: "refine_failed" };
  }
}

/**
 * Archive a hypothesis.
 *
 * @param {string} id
 * @returns {{ ok: boolean }}
 */
export function archiveHypothesis(id) {
  try {
    const hyp = _hypotheses.get(id);
    if (!hyp) return { ok: false, error: "not_found" };

    hyp.machine.hypothesis.status = "archived";
    hyp.machine.hypothesis.lifecycle.push({ event: "archived", by: "user", at: nowISO(), note: "Hypothesis archived" });
    hyp.updatedAt = nowISO();

    return { ok: true };
  } catch {
    return { ok: false, error: "archive_failed" };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get aggregate metrics across all hypotheses.
 *
 * @returns {{ ok: boolean, total: number, byStatus: object, avgConfidence: number, factsDTUsCreated: number, rejectionDTUsCreated: number }}
 */
export function getHypothesisMetrics() {
  try {
    const byStatus = {};
    for (const s of HYPOTHESIS_STATUSES) byStatus[s] = 0;

    let totalConfidence = 0;
    let count = 0;

    for (const hyp of _hypotheses.values()) {
      const h = hyp.machine.hypothesis;
      byStatus[h.status] = (byStatus[h.status] || 0) + 1;
      totalConfidence += h.confidence;
      count++;
    }

    return {
      ok: true,
      total: count,
      byStatus,
      avgConfidence: count > 0 ? Math.round((totalConfidence / count) * 1000) / 1000 : 0,
      factDTUsCreated: _factDTUs.size,
      rejectionDTUsCreated: _rejectionDTUs.size,
    };
  } catch {
    return { ok: false, error: "metrics_failed" };
  }
}
