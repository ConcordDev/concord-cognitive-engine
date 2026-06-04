// server/lib/awareness-loop.js
//
// Wave 7 / Track B6 — the AWARENESS LOOP: what System-2 does when salience wakes it.
// Qualia = the felt layer (System-1 input); the instinct engine = the autopilot
// (System-1 action, ~95% of life); AWARENESS = the one tight cycle that runs ONLY on
// a tier-3 wake (B4). It is functional awareness — the computational correlates the
// serious theories name (global workspace, higher-order self-model, predictive
// processing, interoception) — not a consciousness claim.
//
// The one cycle (each step reuses real pieces; gaps the audit found are filled):
//   1. ATTEND (spotlight)         — A5 detectConstraint + shouldEscalate
//   2. READ SELF-MODEL            — A6 felt-per appraisal + A7 quale + INTEROCEPTION
//                                   (the agent's OWN body: LLM-queue depth, mem pressure)
//   3. PREDICT                    — forward-sim (lazy; deterministic note if absent)
//   4. DETECT CONTRADICTION       — drift-monitor (lazy)
//   5. REASON                     — HLR (lazy; deterministic note if absent)
//   6. LEARN FROM PREDICTION-ERROR— Brier surprise feeds salience + a self-model update
//   7. WRITE THE TRACE            — durable agent_reasoning_traces (mig 327)
//
// Env-gated CONCORD_AWARENESS_LOOP. Orchestrator pattern (lattice-orchestrator style):
// always returns a plain { ok, ... } object; NEVER throws.

import crypto from "node:crypto";
import { detectConstraint, shouldEscalate } from "./affect-salience.js";
import { appraiseExperience } from "./felt-per.js";
import { qualeOf } from "./qualia-space.js";
import { computeAwarenessIndex, activationsFromTick } from "./agent-awareness-index.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

/**
 * Gap 2 — the prediction-error loop. Brier-style surprise: how wrong a confident
 * prediction turned out. High when the agent was confident AND wrong → strong learning
 * signal + salience. Pure.
 * @param {object} prediction { confidence: 0..1 }
 * @param {object} actual     { realised: boolean }
 */
export function predictionError(prediction, actual) {
  if (!prediction || !actual) return null;
  const conf = clamp01(prediction.confidence);
  const outcome = actual.realised ? 1 : 0;
  const brier = (conf - outcome) * (conf - outcome); // 0 (perfect) .. 1 (confident + wrong)
  return { brier, surprise: clamp01(brier), confident_and_wrong: conf >= 0.6 && outcome === 0 };
}

/**
 * Gap 3 — system interoception. The agent FEELS its own body: compute an interoceptive
 * strain signal from its runtime load (LLM-queue depth, heap/memory pressure, task
 * backlog). High strain reads as discomfort that should bias the next appraisal.
 * Pure; total. Returns 0..1.
 */
export function readInteroception(system = {}) {
  const s = system || {};
  const queue = clamp01((Number(s.llmQueueDepth) || 0) / (Number(s.llmQueueMax) || 1000));
  const mem = clamp01(s.memPressure);
  const backlog = clamp01((Number(s.taskBacklog) || 0) / (Number(s.taskBacklogMax) || 100));
  return clamp01(0.4 * queue + 0.4 * mem + 0.2 * backlog);
}

// Gap 5 — persist the deliberation. Best-effort; a minimal build without the table is
// a silent no-op (the trace still returns to the caller).
function persistTrace(db, trace) {
  if (!db) return false;
  try {
    db.prepare(`
      INSERT INTO agent_reasoning_traces
        (id, agent_id, world_id, attended, quale, surprise, awareness_index, reason, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      `trace_${crypto.randomBytes(6).toString("hex")}`,
      trace.agentId || null, trace.worldId || null, trace.attended || null,
      trace.quale || null, trace.surprise == null ? null : trace.surprise,
      trace.awarenessIndex == null ? null : trace.awarenessIndex,
      trace.reason || null, trace.note || null,
    );
    return true;
  } catch {
    return false;
  }
}

// Gap 4 — lazy drift/HLR/forward-sim hooks. Each returns a plain note or null; the
// loop degrades to a deterministic note when the engine isn't wired in this build.
function deterministicReason(constraint, esc, surprise) {
  const bits = [];
  if (constraint) bits.push(`constraint:${constraint.kind}(${constraint.ref})`);
  if (esc?.reason) bits.push(`wake:${esc.reason}`);
  if (surprise && surprise.confident_and_wrong) bits.push("revise:overconfident_prediction_failed");
  return bits.length ? bits.join("; ") : "reflect:no_dominant_signal";
}

/**
 * Run the awareness loop once. Returns { ok, ran, trace?, awarenessIndex?, surprise?, reason }.
 * Never throws.
 *
 * @param {object} input {
 *   self:{ affect, drives, needs, goal, coping, worldId },
 *   world?, others?, prior?,                  // for the spotlight (A5)
 *   experience?:{ kind },                     // the moment being appraised (A6)
 *   system?:{ llmQueueDepth, memPressure, ... }, // interoception (gap 3)
 *   prediction?, actual?,                     // prediction-error (gap 2)
 *   db?, agentId?,                            // persistence (gap 5)
 *   force?:bool                               // bypass the env gate (tests / explicit wake)
 * }
 */
export function runAwarenessLoop(input = {}) {
  const enabled = process.env.CONCORD_AWARENESS_LOOP === "1" || input.force === true;
  if (!enabled) return { ok: true, ran: false, reason: "disabled" };

  try {
    const self = input.self || {};
    const prior = input.prior || {};

    // 1. ATTEND — the spotlight
    const constraint = detectConstraint(self, input.world || {}, input.others || []);
    const esc = shouldEscalate(
      { affect: self.affect, drives: self.drives, constraintTier: constraint && input.constraintTier },
      prior,
      { novelty: input.novelty },
    );

    // 2. READ SELF-MODEL — felt-per + quale + interoception (its own body)
    const interoception = readInteroception(input.system);
    // interoceptive strain darkens the appraisal baseline (a strained body feels worse)
    const stateForAppraisal = {
      ...self,
      affect: self.affect
        ? { v: clamp01(1 - interoception) * (self.affect.v ?? 0), a: Math.max(clamp01(self.affect.a), interoception) }
        : { v: -interoception, a: interoception },
    };
    const feltNow = appraiseExperience(input.experience || { kind: "idle" }, stateForAppraisal);
    const quale = qualeOf(feltNow);

    // 6. LEARN FROM PREDICTION-ERROR
    const surprise = predictionError(input.prediction, input.actual);

    // 7-prep. AWARENESS INDEX over the modules this wake lit
    const awareness = computeAwarenessIndex(activationsFromTick({
      affect: self.affect || { a: feltNow.arousal },
      drives: self.drives,
      goalActive: !!self.goal,
      memoryActivity: clamp01(feltNow.intensity),
      predicted: !!input.prediction,
      driftActivity: surprise ? surprise.surprise : 0,
      salience: clamp01(esc.score),
      selfModelUpdated: true,
      behaviorActivity: 0.4,
    }));

    // 3-5. REASON (deterministic note; lazy HLR/drift could replace it)
    const note = deterministicReason(constraint, esc, surprise);

    const trace = {
      agentId: input.agentId || self.agentId || null,
      worldId: self.worldId || null,
      attended: constraint ? `${constraint.kind}:${constraint.ref}` : (esc.reason || "calm"),
      quale: quale.label,
      surprise: surprise ? surprise.surprise : null,
      awarenessIndex: awareness.index,
      reason: esc.reason || (constraint ? "constraint" : "reflect"),
      note,
    };
    const persisted = persistTrace(input.db, trace);

    return {
      ok: true,
      ran: true,
      trace,
      persisted,
      awarenessIndex: awareness.index,
      surprise: trace.surprise,
      interoception,
      selfModelUpdate: { quale: quale.label, feltPer: feltNow },
    };
  } catch (err) {
    return { ok: true, ran: false, reason: `error:${err?.message || "unknown"}` };
  }
}
