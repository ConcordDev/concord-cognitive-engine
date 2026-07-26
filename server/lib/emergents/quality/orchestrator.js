// server/lib/emergents/quality/orchestrator.js
// Five-stage quality pipeline for emergent-produced drafts.
// Stages: self-critique → deterministic gates → peer review → council → track

import { runSelfCritique } from "./self-critique.js";
import { runDeterministicGates } from "./deterministic-gates.js";
import { selectReviewers, peerReview, determineConsensus } from "./peer-review.js";
import { councilDecision } from "../../agentic/council.js";
import { recordQualityOutcome, updateTrustFromOutcome } from "./track.js";

function buildDraft(task, result) {
  return {
    body: result.finalText || "",
    content: { body: result.finalText || "" },
    lens: task.task_data?.lens,
    task_type: task.task_type,
    lineage: task.task_data?.sourceDTUs || [],
  };
}

function reject(emergentId, taskId, stages, reason, db) {
  recordQualityOutcome({ emergentId, taskId, decision: "reject", stages, qualityScore: 0 }, db);
  updateTrustFromOutcome(emergentId, "reject", db);
  return { approved: false, finalDraft: null, reason };
}

/**
 * Run the full quality pipeline on an emergent-produced draft.
 *
 * @param {{ emergentId, identity, task, result, sources, db, parentInferenceId }} opts
 * @returns {Promise<{ approved: boolean, finalDraft: object|null, reason: string }>}
 */
export async function runQualityPipeline({ emergentId, identity, task, result, sources, db, parentInferenceId }) {
  const stages = {};
  // The caller (emergent/minor-agent.js) passes its full identity object for
  // traceability; it was previously accepted and discarded. recordQualityOutcome
  // persists `stages` verbatim as stages_json, so stamping a display name here
  // makes the quality-history record attributable to which emergent persona
  // produced the draft, without touching the approve/reject decision itself.
  if (identity?.given_name) stages.identity = identity.given_name;

  let draft;
  try {
    draft = buildDraft(task, result);
  } catch {
    return reject(emergentId, task?.id, stages, "draft_construction_failed", db);
  }

  // Stage 1: Self-critique
  try {
    const selfCritique = await runSelfCritique(
      emergentId, draft, sources || [], parentInferenceId || task?.id, db
    );
    stages.selfCritique = { passed: selfCritique.passed, cycles: selfCritique.cycles };
    if (!selfCritique.passed) {
      return reject(emergentId, task?.id, stages, "self_critique_failed", db);
    }
    draft = selfCritique.finalDraft;
  } catch {
    stages.selfCritique = { passed: false, error: true };
    return reject(emergentId, task?.id, stages, "self_critique_error", db);
  }

  // Stage 2: Deterministic gates
  try {
    const gates = runDeterministicGates(draft, db);
    stages.deterministicGates = { passed: gates.passed, failures: gates.failures.map(f => f.name) };
    if (!gates.passed) {
      return reject(emergentId, task?.id, stages, "deterministic_gates_failed", db);
    }
  } catch {
    stages.deterministicGates = { passed: false, error: true };
    return reject(emergentId, task?.id, stages, "deterministic_gates_error", db);
  }

  // Stage 3: Peer review
  let consensusDecision = "approve";
  try {
    const reviewers = selectReviewers(draft, db, { count: 2, excludeId: emergentId });
    if (reviewers.length > 0) {
      const reviews = await Promise.all(
        reviewers.map(r => peerReview(r, draft, parentInferenceId || task?.id, db))
      );
      const consensus = determineConsensus(reviews);
      stages.peerReview = {
        reviewerCount: reviewers.length,
        verdicts: reviews.map(r => r.verdict),
        consensus: consensus.consensus,
      };
      consensusDecision = consensus.consensus;
    } else {
      stages.peerReview = { reviewerCount: 0, consensus: "approve" };
    }
  } catch {
    stages.peerReview = { error: true, consensus: "approve" };
  }

  if (consensusDecision === "reject") {
    return reject(emergentId, task?.id, stages, "peer_review_rejected", db);
  }

  // Stage 4: Council escalation on split peer review
  if (consensusDecision === "escalate") {
    try {
      const councilResult = await councilDecision({
        question: `Should this emergent ${draft.task_type} DTU be promoted to the substrate?\n\n${(draft.body || "").slice(0, 800)}`,
        parentInferenceId: parentInferenceId || task?.id,
        brainRole: "subconscious",
        db,
      });
      stages.council = { confidence: councilResult.confidence, councilUsed: councilResult.councilUsed };
      consensusDecision = councilResult.confidence >= 0.5 ? "approve" : "reject";
    } catch {
      stages.council = { error: true };
      consensusDecision = "reject";
    }
  }

  if (consensusDecision !== "approve") {
    return reject(emergentId, task?.id, stages, "council_rejected", db);
  }

  // Stage 5: Record approved outcome and trust adjustment
  const outcomeId = recordQualityOutcome({
    emergentId,
    taskId: task?.id,
    decision: "approve",
    stages,
    qualityScore: 0.85,
  }, db);
  updateTrustFromOutcome(emergentId, "approve", db);
  stages.outcome = { id: outcomeId };

  return { approved: true, finalDraft: draft, reason: "approve" };
}
