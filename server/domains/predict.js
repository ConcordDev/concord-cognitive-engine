// server/domains/predict.js
//
// Concord Predict — a probabilistic prediction/forecasting engine built as a
// real domain over the PredictionTicket substrate (migration 418).
//
// A ticket is immutable at creation: predict.create freezes the forecast +
// the feature snapshot that produced it; predict.resolve records the
// eventual outcome into a SEPARATE table and can never rewrite what the
// ticket claimed to know at prediction time. That split is the temporal
// firewall the rest of this file's calibration/walk-forward math depends on
// — a calibration number is only honest if the forecast it's grading was
// genuinely frozen before the outcome existed.
//
// Reuse, not rebuild, per this repo's own convention: Brier score / log-loss
// / reliability curves come from lib/calibration-math.js (shared with
// domains/metacognition.js), the seeded RNG comes from domains/sim.js
// (shared with sim.monteCarlo), historical price data comes from the real
// crypto.token-candles CoinGecko integration (called via LENS_ACTIONS, never
// re-fetched here), and multiple-comparison correction comes from
// hypothesis.multipleComparison. The one genuinely new primitive is the
// Monte Carlo convergence detector (lib/probability/monte-carlo-convergence.js).

import { createDTU } from "../economy/dtu-pipeline.js";
import { uid } from "../lib/id-factory.js";
import {
  computeBrierScore, computeBrierSkillScore, computeLogLoss,
  computeReliabilityBins, computeECE, computeMCE, calibrationQualityLabel,
} from "../lib/calibration-math.js";
import { makeRng, gaussian } from "./sim.js";
import { runConvergentMonteCarlo, DEFAULT_SAMPLE_SCHEDULE } from "../lib/probability/monte-carlo-convergence.js";
import { registerCapability } from "../lib/runtime/capability-registry.js";
import { publish as publishRuntimeEvent } from "../lib/runtime/event-bus.js";
import { operatorOnlyRegistrar } from "../lib/runtime/operator-gate.js";

const r = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);

// A calibration/walk-forward finding is only worth a permanent DTU once the
// sample is big enough that the number means something — otherwise the
// substrate fills with noise from every three-ticket toy calibration.
const CALIBRATION_DTU_MIN_N = 30;
const WALKFORWARD_DTU_MIN_N = 10;

const ANALOG_CAVEAT = "Historical analog similarity is NOT evidence of causality — matching a past price/volatility pattern does not imply the same forward outcome will recur. Treat this as one weak, correlational input among many, never as a standalone signal.";

// Guarantees strictly-increasing timestamps across same-millisecond calls
// (a synchronous test loop calling predict.create in a tight loop can
// otherwise produce ties, which breaks the "chronological order" guarantee
// predict.walkForward depends on).
let _lastTs = 0;
function nextTs() {
  const now = Date.now();
  _lastTs = now > _lastTs ? now : _lastTs + 1;
  return _lastTs;
}

/** Call another domain's registerLensAction handler directly (LENS_ACTIONS is
 * exposed on globalThis for exactly this — see server.js's mcp dispatch
 * comment). Returns null if the target handler isn't registered (e.g. a
 * minimal build without that domain loaded) so callers degrade honestly
 * instead of throwing. */
function callLensAction(domain, action, params, ctx) {
  const handler = globalThis.__concordLensActions?.get(`${domain}.${action}`);
  if (!handler) return null;
  const artifact = { id: null, domain, type: "domain_action", data: params, meta: {} };
  return handler(ctx, artifact, params);
}

/** Merges artifact.data (Tier-A calc convention) with params (Tier-B CRUD
 * convention) — HTTP-originated calls already alias the two; the test
 * harness may populate either, so read from both. */
function payloadOf(artifact, params) {
  const fromData = artifact && typeof artifact.data === "object" && artifact.data ? artifact.data : {};
  const fromParams = params && typeof params === "object" ? params : {};
  return { ...fromData, ...fromParams };
}

function toBinaryOutcome(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "TRUE") return 1;
  if (v === false || v === 0 || v === "0" || v === "false" || v === "FALSE") return 0;
  return null;
}

/** Default binary payoff for a contract priced at the market probability
 * (the Kalshi/Polymarket YES-share convention): win pays (1-price) per unit
 * staked, loss costs `price` per unit staked. Overridable via params.payoff. */
function defaultBinaryPayoff(marketProbability, stake) {
  return { win: stake * (1 - marketProbability), loss: stake * marketProbability };
}

function binaryEdgeEv(forecastProbability, marketProbability, costs, payoff) {
  const totalCost = (Number(costs?.fee) || 0) + (Number(costs?.spread) || 0) + (Number(costs?.slippage) || 0);
  const edge = forecastProbability - marketProbability;
  const ev = forecastProbability * payoff.win - (1 - forecastProbability) * payoff.loss - totalCost;
  return { edge, ev, totalCost };
}

function rowToTicket(row) {
  if (!row) return null;
  const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
  return {
    id: row.id,
    createdAt: row.created_at,
    subject: row.subject,
    eventDefinition: row.event_definition,
    horizonSeconds: row.horizon_seconds,
    targetVariable: row.target_variable,
    currentState: parse(row.current_state_json),
    forecastDistribution: parse(row.forecast_distribution_json),
    pointProbability: row.point_probability,
    uncertaintyInterval: parse(row.uncertainty_interval_json),
    confidence: row.confidence,
    regime: row.regime,
    featureSnapshot: parse(row.feature_snapshot_json),
    historicalAnalogs: parse(row.historical_analogs_json),
    modelId: row.model_id,
    modelVersion: row.model_version,
    datasetVersion: row.dataset_version,
    simulationVersion: row.simulation_version,
    marketProbability: row.market_probability,
    estimatedEdge: row.estimated_edge,
    estimatedEv: row.estimated_ev,
    costs: parse(row.costs_json),
    decision: row.decision,
    creatorId: row.creator_id,
    outcome: row.resolved_at ? {
      resolvedAt: row.resolved_at,
      actualValue: parse(row.actual_value_json),
      actualOutcome: row.actual_outcome,
      resolutionSource: row.resolution_source,
      scoreBrier: row.score_brier,
      scoreLogLoss: row.score_log_loss,
    } : null,
  };
}

const TICKET_WITH_OUTCOME_SQL = `
  SELECT t.*, o.resolved_at, o.actual_value_json, o.actual_outcome,
         o.resolution_source, o.score_brier, o.score_log_loss
  FROM prediction_tickets t
  LEFT JOIN prediction_outcomes o ON o.prediction_id = t.id
`;

function maybeRecordFinding(ctx, db, { kind, title, content, metadata }) {
  try {
    const res = createDTU(db, {
      creatorId: ctx?.actor?.userId || "system",
      title: title.slice(0, 160),
      content,
      contentType: "text",
      lensId: "predict",
      tier: "REGULAR",
      tags: ["predict", kind],
      citationMode: "original",
      metadata: { kind, ...metadata },
    });
    const dtuId = res?.ok ? res.dtu?.id || null : null;
    if (dtuId) publishRuntimeEvent("finding.created", { dtuId, kind, title: title.slice(0, 160) });
    return dtuId;
  } catch {
    return null;
  }
}

// Concord Runtime capability registrations (docs/CONCORD_RUNTIME_MASTER_SPEC.md
// §2) — Predict is the first domain onboarded into the registry, proving
// the pattern against real, live, already-deployed code rather than a toy
// example. Metadata only; the handlers below still enforce their own real
// authorization exactly as before (see predict.promoteAuthority's own
// docstring for why "risk: high" here is descriptive, not the enforcement).
const CAPABILITY_DESCRIPTORS = [
  { capability: "predict.create", owner: "predict", risk: "write", description: "Mint an immutable PredictionTicket.", dependencies: ["db"] },
  { capability: "predict.resolve", owner: "predict", risk: "write", description: "Record a ticket's real outcome (temporal firewall — can never touch the ticket itself).", dependencies: ["db"] },
  { capability: "predict.get", owner: "predict", risk: "read", description: "Fetch one ticket + its outcome, if resolved.", dependencies: ["db"] },
  { capability: "predict.list", owner: "predict", risk: "read", description: "List tickets by filter.", dependencies: ["db"] },
  { capability: "predict.calibration", owner: "predict", risk: "compute", description: "Brier/log-loss/ECE calibration report over resolved tickets.", dependencies: ["db"] },
  { capability: "predict.montecarlo", owner: "predict", risk: "compute", description: "Seeded Monte Carlo estimator with convergence detection.", dependencies: [] },
  { capability: "predict.analog", owner: "predict", risk: "compute", description: "Historical analog search (correlational, not causal — see the built-in caveat).", dependencies: ["crypto.token-candles"] },
  { capability: "predict.marketCompare", owner: "predict", risk: "compute", description: "Forecast-vs-market edge/EV for a binary or multi-outcome bet.", dependencies: [] },
  { capability: "predict.walkForward", owner: "predict", risk: "compute", description: "Chronological train/test evaluation, no-lookahead.", dependencies: ["db"] },
  { capability: "predict.reconcile", owner: "predict", risk: "compute", description: "Live-vs-backtest trade economics (P2) + advisory EV (P5, observational only).", dependencies: ["db"] },
  { capability: "predict.authorityStatus", owner: "predict", risk: "compute", description: "Evidence-gated capability-lifecycle stage (P6) — cannot itself grant authority.", dependencies: ["db", "predict.reconcile", "predict.calibration"] },
  {
    capability: "predict.promoteAuthority", owner: "predict", risk: "high",
    description: "The ONLY path to a model's PROMOTED stage — records an operator decision in Concord's own bookkeeping. Does NOT and cannot grant real trading authority (no execution channel exists).",
    authorization: "operatorId + confirm:true, and evidenceStage must be VALIDATED (recomputed fresh every call)",
    dependencies: ["db", "predict.authorityStatus"],
  },
];
for (const descriptor of CAPABILITY_DESCRIPTORS) registerCapability(descriptor);

export default function registerPredictActions(rawRegistrar) {
  // Operator-only: tickets have no owner column (one global pool that holds
  // Dila's live-trade tickets) — members could list or RESOLVE them.
  const registerLensAction = operatorOnlyRegistrar(rawRegistrar);
  /**
   * predict.create — mint an immutable PredictionTicket. Everything that
   * describes "what was known/believed at prediction time" is frozen here;
   * no other macro in this file can ever rewrite these columns.
   * required: subject, eventDefinition, horizonSeconds, modelId,
   *           forecastDistribution, featureSnapshot (explicitly, even {})
   */
  registerLensAction("predict", "create", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);

      const subject = typeof p.subject === "string" ? p.subject.trim() : "";
      const eventDefinition = typeof p.eventDefinition === "string" ? p.eventDefinition.trim()
        : (typeof p.event_definition === "string" ? p.event_definition.trim() : "");
      const horizonSeconds = Number(p.horizonSeconds ?? p.horizon_seconds);
      const modelId = typeof p.modelId === "string" ? p.modelId.trim() : "";
      const forecastDistribution = p.forecastDistribution && typeof p.forecastDistribution === "object"
        ? p.forecastDistribution : null;

      if (!subject) return { ok: false, reason: "missing_subject" };
      if (!eventDefinition) return { ok: false, reason: "missing_event_definition" };
      if (!Number.isFinite(horizonSeconds) || horizonSeconds <= 0) return { ok: false, reason: "invalid_horizon_seconds" };
      if (!modelId) return { ok: false, reason: "missing_model_id" };
      if (!forecastDistribution) return { ok: false, reason: "missing_forecast_distribution" };
      // featureSnapshot must be EXPLICITLY provided (even {}) — this is what
      // "immutable-at-creation, no-lookahead" is grading against, so an
      // omitted key (vs. a genuinely empty snapshot) is a caller error.
      if (!("featureSnapshot" in p) || typeof p.featureSnapshot !== "object" || p.featureSnapshot === null) {
        return { ok: false, reason: "missing_feature_snapshot" };
      }

      let pointProbability = null;
      if (p.pointProbability !== undefined && p.pointProbability !== null) {
        pointProbability = Number(p.pointProbability);
        if (!Number.isFinite(pointProbability) || pointProbability < 0 || pointProbability > 1) {
          return { ok: false, reason: "invalid_point_probability" };
        }
      } else if (Number.isFinite(Number(forecastDistribution.prob))) {
        pointProbability = Number(forecastDistribution.prob);
      }

      let marketProbability = null;
      if (p.marketProbability !== undefined && p.marketProbability !== null) {
        marketProbability = Number(p.marketProbability);
        if (!Number.isFinite(marketProbability) || marketProbability < 0 || marketProbability > 1) {
          return { ok: false, reason: "invalid_market_probability" };
        }
      }

      let estimatedEdge = null;
      let estimatedEv = null;
      if (pointProbability !== null && marketProbability !== null) {
        const costs = p.costs && typeof p.costs === "object" ? p.costs : {};
        const stake = Number.isFinite(Number(p.stake)) && Number(p.stake) > 0 ? Number(p.stake) : 1;
        const payoff = p.payoff && Number.isFinite(Number(p.payoff.win)) && Number.isFinite(Number(p.payoff.loss))
          ? { win: Number(p.payoff.win), loss: Number(p.payoff.loss) }
          : defaultBinaryPayoff(marketProbability, stake);
        const { edge, ev } = binaryEdgeEv(pointProbability, marketProbability, costs, payoff);
        estimatedEdge = edge;
        estimatedEv = ev;
      }

      const id = uid("pred");
      const now = nextTs();
      const decision = typeof p.decision === "string" && p.decision ? p.decision : "WATCH";

      db.prepare(`
        INSERT INTO prediction_tickets (
          id, created_at, subject, event_definition, horizon_seconds, target_variable,
          current_state_json, forecast_distribution_json, point_probability,
          uncertainty_interval_json, confidence, regime, feature_snapshot_json,
          historical_analogs_json, model_id, model_version, dataset_version,
          simulation_version, market_probability, estimated_edge, estimated_ev,
          costs_json, decision, creator_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, now, subject, eventDefinition, Math.round(horizonSeconds),
        p.targetVariable || null,
        p.currentState ? JSON.stringify(p.currentState) : null,
        JSON.stringify(forecastDistribution),
        pointProbability,
        p.uncertaintyInterval ? JSON.stringify(p.uncertaintyInterval) : null,
        Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
        p.regime || null,
        JSON.stringify(p.featureSnapshot),
        p.historicalAnalogs ? JSON.stringify(p.historicalAnalogs) : null,
        modelId, p.modelVersion || null, p.datasetVersion || null, p.simulationVersion || null,
        marketProbability, estimatedEdge, estimatedEv,
        p.costs ? JSON.stringify(p.costs) : null,
        decision, ctx?.actor?.userId || "anon",
      );

      const row = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE t.id = ?`).get(id);
      const ticket = rowToTicket(row);
      publishRuntimeEvent("prediction.created", { id: ticket.id, subject: ticket.subject, modelId: ticket.modelId, decision: ticket.decision });
      return { ok: true, result: { ticket } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.resolve — record the eventual outcome for a ticket. Only ever
   * INSERTs into prediction_outcomes; a resolve call can never touch
   * prediction_tickets, so passing (accidentally or otherwise) a revised
   * forecastDistribution/featureSnapshot alongside the resolve call has
   * zero effect on what the ticket is graded against — that's the temporal
   * firewall, enforced structurally rather than by a runtime check.
   * required: id, actualOutcome
   */
  registerLensAction("predict", "resolve", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      const id = p.id || p.predictionId;
      if (!id) return { ok: false, reason: "missing_id" };

      const ticket = db.prepare("SELECT * FROM prediction_tickets WHERE id = ?").get(id);
      if (!ticket) return { ok: false, reason: "not_found" };
      const already = db.prepare("SELECT prediction_id FROM prediction_outcomes WHERE prediction_id = ?").get(id);
      if (already) return { ok: false, reason: "already_resolved" };

      if (p.actualOutcome === undefined || p.actualOutcome === null) {
        return { ok: false, reason: "missing_actual_outcome" };
      }

      const binaryActual = toBinaryOutcome(p.actualOutcome);
      let scoreBrier = null;
      let scoreLogLoss = null;
      if (ticket.point_probability !== null && ticket.point_probability !== undefined && binaryActual !== null) {
        const pair = [{ predicted: ticket.point_probability, actual: binaryActual }];
        scoreBrier = computeBrierScore(pair);
        scoreLogLoss = computeLogLoss(pair);
      }

      const resolvedAt = nextTs();
      db.prepare(`
        INSERT INTO prediction_outcomes (
          prediction_id, resolved_at, actual_value_json, actual_outcome,
          resolution_source, score_brier, score_log_loss
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        id, resolvedAt,
        p.actualValue !== undefined ? JSON.stringify(p.actualValue) : JSON.stringify(p.actualOutcome),
        String(p.actualOutcome),
        p.resolutionSource || null,
        scoreBrier, scoreLogLoss,
      );

      const row = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE t.id = ?`).get(id);
      const resolvedTicket = rowToTicket(row);
      publishRuntimeEvent("prediction.resolved", { id: resolvedTicket.id, subject: resolvedTicket.subject, modelId: resolvedTicket.modelId, actualOutcome: resolvedTicket.outcome?.actualOutcome, scoreBrier: resolvedTicket.outcome?.scoreBrier });
      return { ok: true, result: { ticket: resolvedTicket } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** predict.get — id required. */
  registerLensAction("predict", "get", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      const id = p.id || p.predictionId;
      if (!id) return { ok: false, reason: "missing_id" };
      const row = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE t.id = ?`).get(id);
      if (!row) return { ok: false, reason: "not_found" };
      return { ok: true, result: { ticket: rowToTicket(row) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** predict.list — filters: subject, modelId, regime, resolved (bool), fromTs, toTs, limit (<=200). */
  registerLensAction("predict", "list", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      const clauses = [];
      const args = [];
      if (p.subject) { clauses.push("t.subject = ?"); args.push(p.subject); }
      if (p.modelId) { clauses.push("t.model_id = ?"); args.push(p.modelId); }
      if (p.regime) { clauses.push("t.regime = ?"); args.push(p.regime); }
      if (p.resolved === true) clauses.push("o.resolved_at IS NOT NULL");
      if (p.resolved === false) clauses.push("o.resolved_at IS NULL");
      if (Number.isFinite(Number(p.fromTs))) { clauses.push("t.created_at >= ?"); args.push(Number(p.fromTs)); }
      if (Number.isFinite(Number(p.toTs))) { clauses.push("t.created_at <= ?"); args.push(Number(p.toTs)); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
      const rows = db.prepare(`${TICKET_WITH_OUTCOME_SQL} ${where} ORDER BY t.created_at ASC LIMIT ?`).all(...args, limit);
      return { ok: true, result: { tickets: rows.map(rowToTicket), count: rows.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.calibration — Brier/skill/log-loss + reliability curve over a
   * set of RESOLVED tickets (score_brier IS NOT NULL — i.e. binary tickets
   * that actually resolved). Filters: subject, modelId, regime.
   * Every number here is reported alongside its sample size — a calibration
   * stat with no visible N is exactly the failure mode this repo has
   * learned to distrust.
   */
  registerLensAction("predict", "calibration", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      const clauses = ["o.score_brier IS NOT NULL"];
      const args = [];
      if (p.subject) { clauses.push("t.subject = ?"); args.push(p.subject); }
      if (p.modelId) { clauses.push("t.model_id = ?"); args.push(p.modelId); }
      if (p.regime) { clauses.push("t.regime = ?"); args.push(p.regime); }
      const rows = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at ASC`).all(...args);
      const n = rows.length;
      if (n < 2) {
        return { ok: true, result: { n, message: "Insufficient resolved sample for a calibration report (need >= 2).", reliability: [] } };
      }
      const numBins = Math.min(Math.max(Math.round(Number(p.bins) || 10), 2), 20);
      const pairs = rows.map((row) => ({ predicted: row.point_probability, actual: toBinaryOutcome(row.actual_outcome) ?? 0 }));
      const brierScore = computeBrierScore(pairs);
      const baseRate = pairs.reduce((s, x) => s + x.actual, 0) / n;
      const brierSkillScore = computeBrierSkillScore(brierScore, baseRate);
      const logLoss = computeLogLoss(pairs);
      const rawBins = computeReliabilityBins(pairs, numBins);
      const reliability = rawBins.map((b) => (b.count === 0
        ? { binRange: [r(b.lower), r(b.upper)], count: 0, predicted: null, observed: null, gap: null }
        : { binRange: [r(b.lower), r(b.upper)], count: b.count, predicted: r(b.meanPredicted), observed: r(b.meanActual), gap: r(b.gap) }));
      const ece = computeECE(rawBins, n);
      const mce = computeMCE(rawBins);

      const result = {
        n,
        brierScore: r(brierScore),
        brierSkillScore: r(brierSkillScore),
        logLoss: r(logLoss),
        baseRate: r(baseRate),
        ece: r(ece),
        mce: r(mce),
        quality: calibrationQualityLabel(ece),
        reliability,
        filters: { subject: p.subject || null, modelId: p.modelId || null, regime: p.regime || null },
      };

      let dtuId = null;
      if (n >= CALIBRATION_DTU_MIN_N && p.recordFinding !== false) {
        dtuId = maybeRecordFinding(ctx, db, {
          kind: "calibration_report",
          title: `Calibration report: ${p.modelId || "all models"} / ${p.subject || "all subjects"} (n=${n})`,
          content: JSON.stringify(result, null, 2),
          metadata: { n, brierScore: result.brierScore, ece: result.ece, subject: p.subject || null, modelId: p.modelId || null, regime: p.regime || null },
        });
      }
      return { ok: true, result: { ...result, dtuId } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.reconcile — live-vs-backtest reconciliation (Concord Predict ×
   * Dila integration, P2). Distinct from predict.calibration: calibration
   * grades whether the FORECAST PROBABILITY was honest (Brier/log-loss);
   * this grades whether the live TRADE ECONOMICS (mean return, hit rate,
   * win/loss magnitude, hold period, max favorable excursion) match what a
   * validated backtest claimed they would be. Domain-agnostic by design —
   * this file has no PPO-specific numbers baked in; the caller supplies
   * `benchmark` (the backtest's own numbers) and `stopRule` (falsifiable
   * halt thresholds, e.g. dila-tools' STRATEGY_EXPECTATIONS.md stop-rule
   * table) so the comparison always reflects the CURRENT authoritative
   * research doc, never a copy that can drift out of sync with it.
   *
   * Units: every *Pct field (meanReturnPct, stdDevPct, avgWinPct,
   * avgLossPct, mfePct, and everything in `benchmark`/`stopRule`) is a
   * PERCENT number (4.1 means 4.1%), matching how a research doc like
   * STRATEGY_EXPECTATIONS.md is written. hitRate stays a 0..1 fraction,
   * matching predict.calibration's baseRate convention. The underlying
   * ticket data is stored as a fraction (0.041) — converted to percent
   * (4.1) at the boundary here, nowhere else.
   *
   * required: modelId
   * optional: subject, benchmark {meanReturnPct, hitRate, avgWinPct,
   *   avgLossPct, avgHoldDays}, stopRule [{n, minMeanReturnPct}, ...]
   */
  registerLensAction("predict", "reconcile", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      if (!p.modelId) return { ok: false, reason: "missing_model_id" };

      const clauses = ["o.resolved_at IS NOT NULL", "t.model_id = ?"];
      const args = [p.modelId];
      if (p.subject) { clauses.push("t.subject = ?"); args.push(p.subject); }
      // P3/P4 support: filter by decision so the SAME macro can report on
      // real executed trades (decision="BUY") and on shadow alternatives
      // that were considered but not taken (decision="SHADOW_NOT_CHOSEN")
      // separately, using identical math — that comparison IS the P4
      // counterfactual analysis.
      if (p.decision) { clauses.push("t.decision = ?"); args.push(p.decision); }
      const rows = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at ASC`).all(...args);
      const n = rows.length;
      const filters = { modelId: p.modelId, subject: p.subject || null };

      if (n === 0) {
        return { ok: true, result: { n, message: "No resolved live trades yet for this model — nothing to reconcile.", filters } };
      }

      const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
      const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
      const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
      const stddev = (arr, m) => (arr.length > 1 ? Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1)) : null);
      const toPct = (frac) => (frac === null ? null : frac * 100);

      const trades = rows.map((row) => {
        const av = parse(row.actual_value_json) || {};
        const holdDays = row.resolved_at && row.created_at ? (row.resolved_at - row.created_at) / 86400000 : null;
        return {
          subject: row.subject,
          realizedReturnFrac: num(av.realized_return_pct),
          mfeFrac: num(av.mfe_pct),
          holdDays: num(holdDays),
          outcome: row.actual_outcome, // "true" | "false" | "breakeven" (stored as strings; see toBinaryOutcome)
        };
      });

      const returns = trades.map((t) => t.realizedReturnFrac).filter((x) => x !== null);
      const meanReturnFrac = mean(returns);
      const stdDevFrac = meanReturnFrac !== null ? stddev(returns, meanReturnFrac) : null;

      const wins = trades.filter((t) => t.outcome === "true");
      const losses = trades.filter((t) => t.outcome === "false");
      const decisiveCount = wins.length + losses.length;
      const hitRate = decisiveCount > 0 ? wins.length / decisiveCount : null;
      const avgWinFrac = mean(wins.map((t) => t.realizedReturnFrac).filter((x) => x !== null));
      const avgLossFrac = mean(losses.map((t) => t.realizedReturnFrac).filter((x) => x !== null));
      const avgHoldDays = mean(trades.map((t) => t.holdDays).filter((x) => x !== null));
      const mfeValues = trades.map((t) => t.mfeFrac).filter((x) => x !== null);
      const avgMfeFrac = mfeValues.length ? mean(mfeValues) : null;

      const live = {
        n,
        nWithReturn: returns.length,
        nWithMfe: mfeValues.length,
        meanReturnPct: r(toPct(meanReturnFrac)),
        stdDevPct: r(toPct(stdDevFrac)),
        hitRate: r(hitRate),
        avgWinPct: r(toPct(avgWinFrac)),
        avgLossPct: r(toPct(avgLossFrac)),
        avgHoldDays: r(avgHoldDays),
        avgMfePct: r(toPct(avgMfeFrac)),
      };

      let comparison = null;
      if (p.benchmark && typeof p.benchmark === "object") {
        const b = p.benchmark;
        const delta = (liveV, benchV) => (Number.isFinite(liveV) && Number.isFinite(Number(benchV)) ? r(liveV - Number(benchV)) : null);
        comparison = {
          benchmark: b,
          deltaMeanReturnPct: delta(live.meanReturnPct, b.meanReturnPct),
          deltaHitRate: delta(live.hitRate, b.hitRate),
          deltaAvgWinPct: delta(live.avgWinPct, b.avgWinPct),
          deltaAvgLossPct: delta(live.avgLossPct, b.avgLossPct),
          deltaAvgHoldDays: delta(live.avgHoldDays, b.avgHoldDays),
        };
      }

      let stopRule = null;
      if (Array.isArray(p.stopRule) && p.stopRule.length && live.meanReturnPct !== null) {
        const sorted = p.stopRule
          .filter((c) => Number.isFinite(Number(c?.n)) && Number.isFinite(Number(c?.minMeanReturnPct)))
          .map((c) => ({ n: Number(c.n), minMeanReturnPct: Number(c.minMeanReturnPct) }))
          .sort((a, b) => a.n - b.n);
        const reached = sorted.filter((c) => n >= c.n);
        const currentCheckpoint = reached.length ? reached[reached.length - 1] : null;
        stopRule = {
          checkpoints: sorted,
          currentCheckpoint,
          nextCheckpoint: sorted.find((c) => c.n > n) || null,
          status: currentCheckpoint
            ? (live.meanReturnPct < currentCheckpoint.minMeanReturnPct ? "HALT_CANDIDATE" : "WITHIN_EXPECTED_VARIANCE")
            : "INSUFFICIENT_SAMPLE",
        };
      }

      // P5 — advisory EV (OBSERVATIONAL ONLY, never fed back into trading).
      // Reuses the same binaryEdgeEv/defaultBinaryPayoff math predict.
      // marketCompare uses, but reframed for a domain with no natural
      // market-implied probability: forecastProbability is Predict's own
      // LIVE calibrated hit rate, marketProbability is the BACKTEST's
      // originally-assumed hit rate (from the caller's benchmark) — so
      // `edge` reads as "is live outperforming or underperforming what the
      // validation originally assumed," not a real market comparison.
      // ev is computed in the same percent-per-trade units as
      // meanReturnPct, so it should self-consistently track it when the
      // sample is the same — that agreement is itself a sanity check.
      let advisoryEv = null;
      if (comparison && Number.isFinite(live.hitRate) && Number.isFinite(live.avgWinPct) && Number.isFinite(live.avgLossPct)
          && Number.isFinite(Number(comparison.benchmark.hitRate))) {
        const forecastProbability = live.hitRate;
        const marketProbability = Number(comparison.benchmark.hitRate);
        const payoff = { win: live.avgWinPct, loss: Math.abs(live.avgLossPct) };
        const { edge, ev } = binaryEdgeEv(forecastProbability, marketProbability, {}, payoff);
        advisoryEv = {
          forecastProbability: r(forecastProbability), marketProbability: r(marketProbability),
          payoff, edge: r(edge), evPctPerTrade: r(ev),
          note: "OBSERVATIONAL ONLY. Not consumed by any trading logic — Concord Predict has no execution channel into the trading system. See predict.authorityStatus for the (also non-executing) evidence-gated authority stage.",
        };
      }

      const result = { ...live, filters, comparison, stopRule, advisoryEv };

      let dtuId = null;
      if (stopRule?.status === "HALT_CANDIDATE" && p.recordFinding !== false) {
        dtuId = maybeRecordFinding(ctx, db, {
          kind: "live_vs_backtest_halt_candidate",
          title: `HALT CANDIDATE: ${p.modelId} live mean ${live.meanReturnPct}% below stop-rule floor at n=${stopRule.currentCheckpoint.n}`,
          content: JSON.stringify(result, null, 2),
          metadata: { n, meanReturnPct: live.meanReturnPct, checkpoint: stopRule.currentCheckpoint },
        });
      }

      return { ok: true, result: { ...result, dtuId } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.authorityStatus — P6/P7 evidence-gated capability-promotion
   * status. Computes where a model sits in IDEA -> SHADOW -> TESTED ->
   * VALIDATED -> PROMOTED (docs/CONCORD_RUNTIME_MASTER_SPEC.md §16) from
   * REAL evidence only (live-trade reconciliation + calibration) — never
   * from an assertion. `stage` is the STORED value (only ever promoted to
   * PROMOTED by a human via predict.promoteAuthority, below); `evidenceStage`
   * is what the CURRENT data alone would support, always freshly computed
   * — the two can differ (a past PROMOTED stays PROMOTED even if fresh
   * evidence would only support TESTED, EXCEPT a HALT_CANDIDATE always
   * overrides even a PROMOTED stage down to HALTED, because safety beats
   * a standing authorization).
   *
   * HARD INVARIANT: `authorityGranted` and `executionChannelExists` are
   * ALWAYS false, unconditionally. Concord Predict has no code path from
   * any row in predict_authority_state to a real trading action — this
   * macro can only produce a recommendation/audit record, never authority.
   *
   * required: modelId
   * optional: subject, benchmark, stopRule (same shape as predict.reconcile),
   *   minTestedN (default: stopRule[0].n or 20), minValidatedN (default:
   *   stopRule[2].n or 100), calibrationEceCeiling (default 0.2)
   */
  registerLensAction("predict", "authorityStatus", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      if (!p.modelId) return { ok: false, reason: "missing_model_id" };

      const sortedStopRule = Array.isArray(p.stopRule)
        ? [...p.stopRule].filter((c) => Number.isFinite(Number(c?.n))).sort((a, b) => Number(a.n) - Number(b.n))
        : [];
      const minTestedN = Number.isFinite(Number(p.minTestedN)) ? Number(p.minTestedN) : Number(sortedStopRule[0]?.n) || 20;
      const minValidatedN = Number.isFinite(Number(p.minValidatedN)) ? Number(p.minValidatedN) : Number(sortedStopRule[2]?.n) || 100;
      const eceCeiling = Number.isFinite(Number(p.calibrationEceCeiling)) ? Number(p.calibrationEceCeiling) : 0.2;

      const reconciliation = callLensAction("predict", "reconcile", {
        modelId: p.modelId, subject: p.subject, benchmark: p.benchmark, stopRule: p.stopRule, decision: "BUY", recordFinding: false,
      }, ctx);
      const calibration = callLensAction("predict", "calibration", { modelId: p.modelId, subject: p.subject, recordFinding: false }, ctx);

      const n = reconciliation?.result?.n || 0;
      const halted = reconciliation?.result?.stopRule?.status === "HALT_CANDIDATE";
      const ece = calibration?.result?.ece;
      const calibrationOk = Number.isFinite(ece) ? ece <= eceCeiling : null; // null = not enough data to judge yet

      let evidenceStage;
      const reasons = [];
      if (halted) {
        evidenceStage = "HALTED";
        reasons.push(`Live mean return breached the stop-rule floor at n=${reconciliation.result.stopRule.currentCheckpoint.n} — see predict.reconcile.`);
      } else if (n === 0) {
        evidenceStage = "IDEA";
        reasons.push("No resolved live trades yet.");
      } else if (n < minTestedN) {
        evidenceStage = "SHADOW";
        reasons.push(`n=${n} < minTestedN=${minTestedN} — still accumulating evidence.`);
      } else if (n < minValidatedN) {
        evidenceStage = calibrationOk === false ? "SHADOW" : "TESTED";
        reasons.push(`n=${n} >= minTestedN=${minTestedN}, not yet at minValidatedN=${minValidatedN}.`);
        if (calibrationOk === false) reasons.push(`Calibration ECE ${ece} exceeds ceiling ${eceCeiling} — forecast probabilities are not honest yet.`);
      } else {
        evidenceStage = calibrationOk === false ? "TESTED" : "VALIDATED";
        reasons.push(`n=${n} >= minValidatedN=${minValidatedN}.`);
        if (calibrationOk === false) reasons.push(`Capped below VALIDATED: calibration ECE ${ece} exceeds ceiling ${eceCeiling}.`);
        else if (calibrationOk === null) reasons.push("Calibration not yet computable (need >=2 tickets with point_probability) — capped at TESTED would apply once available.");
      }

      const existing = db.prepare("SELECT * FROM predict_authority_state WHERE model_id = ?").get(p.modelId);
      let persistedStage = evidenceStage;
      let transitioned = false;
      if (existing?.stage === "PROMOTED" && evidenceStage !== "HALTED") {
        persistedStage = "PROMOTED"; // a past human promotion is sticky — evidence alone can't revoke it
      } else {
        transitioned = !existing || existing.stage !== persistedStage;
      }

      const now = nextTs();
      db.prepare(`
        INSERT INTO predict_authority_state (model_id, stage, n, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET stage = excluded.stage, n = excluded.n, updated_at = excluded.updated_at
      `).run(p.modelId, persistedStage, n, now);

      let dtuId = existing?.last_dtu_id || null;
      if (transitioned && p.recordFinding !== false) {
        dtuId = maybeRecordFinding(ctx, db, {
          kind: "predict_authority_transition",
          title: `${p.modelId}: authority stage ${existing?.stage || "(new)"} -> ${persistedStage} (n=${n})`,
          content: JSON.stringify({ modelId: p.modelId, from: existing?.stage || null, to: persistedStage, n, reasons, reconciliation: reconciliation?.result, calibration: calibration?.result }, null, 2),
          metadata: { modelId: p.modelId, from: existing?.stage || null, to: persistedStage, n },
        });
        if (dtuId) db.prepare("UPDATE predict_authority_state SET last_dtu_id = ? WHERE model_id = ?").run(dtuId, p.modelId);
      }

      return {
        ok: true,
        result: {
          modelId: p.modelId,
          stage: persistedStage,
          evidenceStage,
          n,
          reasons,
          thresholds: { minTestedN, minValidatedN, calibrationEceCeiling: eceCeiling },
          reconciliation: reconciliation?.result || null,
          calibration: calibration?.result || null,
          transitioned,
          dtuId,
          authorityGranted: false,
          executionChannelExists: false,
          note: "Concord Predict has no execution channel into any trading system. This status can never itself move money.",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.promoteAuthority — the ONLY way a model's stage can become
   * PROMOTED. Requires an explicit human operatorId + confirm:true, and
   * the model must currently be at evidenceStage VALIDATED (fresh
   * evidence, recomputed here, not trusted from a stale prior call).
   *
   * HARD INVARIANT (same as authorityStatus): this records an operator's
   * decision in Concord's own audit trail. It does NOT and CANNOT grant
   * real trading authority — authorityGranted/executionChannelExists are
   * always false. Building an actual execution channel from Concord into
   * a trading system is a separate, explicit architectural decision this
   * macro cannot make on its own.
   *
   * required: modelId, operatorId, confirm (must be === true)
   * optional: subject, benchmark, stopRule, note
   */
  registerLensAction("predict", "promoteAuthority", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      if (!p.modelId) return { ok: false, reason: "missing_model_id" };
      if (!p.operatorId) return { ok: false, reason: "missing_operator_id" };
      if (p.confirm !== true) return { ok: false, reason: "confirmation_required" };

      const status = callLensAction("predict", "authorityStatus", {
        modelId: p.modelId, subject: p.subject, benchmark: p.benchmark, stopRule: p.stopRule,
        minTestedN: p.minTestedN, minValidatedN: p.minValidatedN, calibrationEceCeiling: p.calibrationEceCeiling,
        recordFinding: false,
      }, ctx);
      const evidenceStage = status?.result?.evidenceStage;
      if (evidenceStage !== "VALIDATED") {
        publishRuntimeEvent("capability.rejected", { capability: "predict.promoteAuthority", modelId: p.modelId, operatorId: p.operatorId, evidenceStage, reason: "not_validated" });
        return { ok: false, reason: "not_validated", evidenceStage, message: `Cannot promote — current evidence stage is ${evidenceStage}, requires VALIDATED.` };
      }

      const now = nextTs();
      db.prepare(`
        INSERT INTO predict_authority_state (model_id, stage, n, updated_at, promoted_by, promoted_at, promotion_note)
        VALUES (?, 'PROMOTED', ?, ?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET stage = 'PROMOTED', updated_at = excluded.updated_at,
          promoted_by = excluded.promoted_by, promoted_at = excluded.promoted_at, promotion_note = excluded.promotion_note
      `).run(p.modelId, status.result.n, now, p.operatorId, now, p.note || null);

      const dtuId = maybeRecordFinding(ctx, db, {
        kind: "predict_authority_promoted",
        title: `${p.modelId} promoted to PROMOTED by operator ${p.operatorId} (n=${status.result.n})`,
        content: JSON.stringify({ modelId: p.modelId, operatorId: p.operatorId, note: p.note || null, evidence: status.result }, null, 2),
        metadata: { modelId: p.modelId, operatorId: p.operatorId, n: status.result.n },
      });
      if (dtuId) db.prepare("UPDATE predict_authority_state SET last_dtu_id = ? WHERE model_id = ?").run(dtuId, p.modelId);

      publishRuntimeEvent("capability.promoted", { capability: `predict.${p.modelId}`, modelId: p.modelId, operatorId: p.operatorId, n: status.result.n, dtuId });

      return {
        ok: true,
        result: {
          modelId: p.modelId, stage: "PROMOTED", promotedBy: p.operatorId, n: status.result.n, dtuId,
          authorityGranted: false,
          executionChannelExists: false,
          note: "This records an operator decision in Concord's own bookkeeping. It does NOT grant real trading authority — no execution channel exists between Concord Predict and any trading system.",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.montecarlo — generic Monte Carlo estimator with escalating-
   * sample-count CONVERGENCE DETECTION (the genuinely new capability here;
   * see lib/probability/monte-carlo-convergence.js). Built-in distributions:
   * normal {mean, stdDev}, lognormal {mu, sigma}, uniform {lo, hi}. metric:
   * "mean" (default, returns the raw draw) or "probabilityAbove"/
   * "probabilityBelow" {threshold} (returns the P(condition) estimate — the
   * "100k sims -> 63.1%, ... CONVERGED" shape).
   */
  registerLensAction("predict", "montecarlo", (ctx, artifact, params) => {
    try {
      const p = payloadOf(artifact, params);
      const distribution = String(p.distribution || "").toLowerCase();
      const dp = p.params && typeof p.params === "object" ? p.params : {};
      let draw;
      if (distribution === "normal") {
        const mean = Number(dp.mean); const stdDev = Number(dp.stdDev);
        if (!Number.isFinite(mean) || !Number.isFinite(stdDev) || stdDev < 0) return { ok: false, reason: "invalid_normal_params" };
        draw = (rng) => mean + stdDev * gaussian(rng);
      } else if (distribution === "lognormal") {
        const mu = Number(dp.mu); const sigma = Number(dp.sigma);
        if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma < 0) return { ok: false, reason: "invalid_lognormal_params" };
        draw = (rng) => Math.exp(mu + sigma * gaussian(rng));
      } else if (distribution === "uniform") {
        const lo = Number(dp.lo); const hi = Number(dp.hi);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { ok: false, reason: "invalid_uniform_params" };
        draw = (rng) => lo + (hi - lo) * rng();
      } else {
        return { ok: false, reason: "unsupported_distribution", supported: ["normal", "lognormal", "uniform"] };
      }

      const metric = String(p.metric || "mean").toLowerCase();
      let sampleOne;
      if (metric === "probabilityabove") {
        const threshold = Number(p.threshold);
        if (!Number.isFinite(threshold)) return { ok: false, reason: "missing_threshold" };
        sampleOne = (rng) => (draw(rng) > threshold ? 1 : 0);
      } else if (metric === "probabilitybelow") {
        const threshold = Number(p.threshold);
        if (!Number.isFinite(threshold)) return { ok: false, reason: "missing_threshold" };
        sampleOne = (rng) => (draw(rng) < threshold ? 1 : 0);
      } else {
        sampleOne = draw;
      }

      const sampleCounts = Array.isArray(p.sampleCounts) && p.sampleCounts.length > 0 ? p.sampleCounts : DEFAULT_SAMPLE_SCHEDULE;
      const seed = Number.isFinite(Number(p.seed)) ? Number(p.seed) : 1;
      const tolerance = Number.isFinite(Number(p.tolerance)) ? Number(p.tolerance) : 0.001;

      const out = runConvergentMonteCarlo(sampleOne, { seed, sampleCounts, tolerance });
      return {
        ok: true,
        result: {
          distribution, metric, seed, tolerance,
          converged: out.converged,
          samplesUsed: out.samplesUsed,
          finalEstimate: r(out.finalMean),
          finalStdDev: r(out.finalStdDev),
          checkpoints: out.checkpoints.map((c) => ({ n: c.n, estimate: r(c.mean), stdDev: r(c.stdDev), delta: c.delta === null ? null : r(c.delta) })),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.analog — historical analog search. Compares a subject's recent
   * [meanReturn, volatility] window against every equal-length window
   * earlier in its own real price history (via crypto.token-candles — no
   * synthetic history), ranks by similarity, and reports the EMPIRICAL
   * forward-return distribution of the topN nearest analogs. NEVER a
   * causality claim — see `caveat` in the result.
   */
  registerLensAction("predict", "analog", (ctx, artifact, params) => {
    try {
      const p = payloadOf(artifact, params);
      const subject = p.subject;
      if (!subject) return { ok: false, reason: "missing_subject" };
      const windowDays = Math.min(Math.max(Math.round(Number(p.windowDays) || 7), 2), 60);
      const horizonDays = Math.min(Math.max(Math.round(Number(p.horizonDays) || 7), 1), 60);
      const topN = Math.min(Math.max(Math.round(Number(p.topN) || 10), 1), 50);
      const days = Math.min(365, windowDays + horizonDays + 300);

      const candlesResult = callLensAction("crypto", "token-candles", { id: subject, days }, ctx);
      if (!candlesResult) return { ok: false, reason: "crypto_domain_unavailable" };
      return candlesResult.then
        ? candlesResult.then((resolved) => _analogFromCandles(resolved, { subject, windowDays, horizonDays, topN }))
        : _analogFromCandles(candlesResult, { subject, windowDays, horizonDays, topN });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  function _analogFromCandles(candlesResult, { subject, windowDays, horizonDays, topN }) {
    if (!candlesResult?.ok) {
      return { ok: false, reason: "data_unavailable", detail: candlesResult?.error || "unknown error fetching historical candles" };
    }
    const candles = candlesResult.result?.candles || [];
    const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
    const minNeeded = windowDays + horizonDays + windowDays;
    if (closes.length < minNeeded) {
      return { ok: true, result: { subject, sampleSize: 0, message: `Insufficient real history (${closes.length} bars, need >= ${minNeeded}) for analog search.`, analogs: [], caveat: ANALOG_CAVEAT } };
    }

    const dailyReturns = [];
    for (let i = 1; i < closes.length; i++) dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);

    function windowFeature(startIdx) {
      const slice = dailyReturns.slice(startIdx, startIdx + windowDays);
      const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
      return { mean, vol: Math.sqrt(variance) };
    }

    const currentStart = dailyReturns.length - windowDays;
    const current = windowFeature(currentStart);

    const candidates = [];
    // Only windows with a FULL forward horizon still inside history are
    // usable analogs (the last `horizonDays` don't have a known outcome yet).
    const lastUsableStart = dailyReturns.length - windowDays - horizonDays;
    for (let start = 0; start <= lastUsableStart - windowDays; start++) {
      const feat = windowFeature(start);
      const dist = Math.sqrt((feat.mean - current.mean) ** 2 + (feat.vol - current.vol) ** 2);
      const forwardStart = start + windowDays;
      const forwardSlice = dailyReturns.slice(forwardStart, forwardStart + horizonDays);
      const forwardReturn = forwardSlice.reduce((acc, v) => acc * (1 + v), 1) - 1;
      candidates.push({ start, distance: dist, forwardReturn });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates.slice(0, Math.min(topN, candidates.length));
    const n = chosen.length;
    if (n === 0) {
      return { ok: true, result: { subject, sampleSize: 0, message: "No usable historical analog windows in the available history.", analogs: [], caveat: ANALOG_CAVEAT } };
    }

    const forwards = chosen.map((c) => c.forwardReturn).sort((a, b) => a - b);
    const mean = forwards.reduce((s, v) => s + v, 0) / n;
    const positive = forwards.filter((v) => v > 0).length;
    const pctl = (q) => forwards[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];

    return {
      ok: true,
      result: {
        subject,
        sampleSize: n,
        currentWindow: { meanDailyReturn: r(current.mean), volatility: r(current.vol), days: windowDays },
        empiricalForwardDistribution: {
          horizonDays,
          mean: r(mean),
          median: r(pctl(0.5)),
          p10: r(pctl(0.1)),
          p90: r(pctl(0.9)),
          fractionPositive: r(positive / n),
        },
        analogs: chosen.map((c) => ({ distance: r(c.distance), forwardReturn: r(c.forwardReturn) })),
        confidence: n < 5 ? "low" : n < 15 ? "moderate" : "adequate",
        caveat: ANALOG_CAVEAT,
      },
    };
  }

  /**
   * predict.marketCompare — pure arithmetic. Binary: EV = p*win - (1-p)*loss
   * - totalCost, default payoff is a contract priced at marketProbability
   * (Kalshi/Polymarket YES-share convention) unless params.payoff overrides
   * it. Multi-outcome: pass params.outcomes = [{prob, payoff}], EV = sum
   * (prob*payoff) - totalCost.
   */
  registerLensAction("predict", "marketCompare", (ctx, artifact, params) => {
    try {
      const p = payloadOf(artifact, params);
      const costs = p.costs && typeof p.costs === "object" ? p.costs : {};
      const totalCost = (Number(costs.fee) || 0) + (Number(costs.spread) || 0) + (Number(costs.slippage) || 0);

      if (Array.isArray(p.outcomes) && p.outcomes.length > 0) {
        const outcomes = p.outcomes.map((o) => ({ prob: Number(o.prob), payoff: Number(o.payoff) }));
        if (outcomes.some((o) => !Number.isFinite(o.prob) || !Number.isFinite(o.payoff))) {
          return { ok: false, reason: "invalid_outcomes" };
        }
        const probSum = outcomes.reduce((s, o) => s + o.prob, 0);
        const ev = outcomes.reduce((s, o) => s + o.prob * o.payoff, 0) - totalCost;
        return { ok: true, result: { kind: "multi_outcome", ev: r(ev), probSum: r(probSum), totalCost: r(totalCost), n: outcomes.length } };
      }

      let forecastProbability = Number(p.forecastProbability);
      if (!Number.isFinite(forecastProbability) && p.predictionId) {
        const db = ctx?.db;
        const ticket = db ? db.prepare("SELECT point_probability FROM prediction_tickets WHERE id = ?").get(p.predictionId) : null;
        if (ticket?.point_probability !== null && ticket?.point_probability !== undefined) forecastProbability = ticket.point_probability;
      }
      const marketProbability = Number(p.marketProbability);
      if (!Number.isFinite(forecastProbability) || forecastProbability < 0 || forecastProbability > 1) {
        return { ok: false, reason: "invalid_forecast_probability" };
      }
      if (!Number.isFinite(marketProbability) || marketProbability < 0 || marketProbability > 1) {
        return { ok: false, reason: "invalid_market_probability" };
      }
      const stake = Number.isFinite(Number(p.stake)) && Number(p.stake) > 0 ? Number(p.stake) : 1;
      const payoff = p.payoff && Number.isFinite(Number(p.payoff.win)) && Number.isFinite(Number(p.payoff.loss))
        ? { win: Number(p.payoff.win), loss: Number(p.payoff.loss) }
        : defaultBinaryPayoff(marketProbability, stake);
      const { edge, ev } = binaryEdgeEv(forecastProbability, marketProbability, costs, payoff);
      return {
        ok: true,
        result: {
          kind: "binary", forecastProbability: r(forecastProbability), marketProbability: r(marketProbability),
          edge: r(edge), ev: r(ev), payoff, totalCost: r(totalCost), stake,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * predict.walkForward — replay resolved tickets in chronological
   * (created_at ASC) order. Each ticket's score comes ONLY from its own
   * frozen point_probability + its own resolution row — no ticket's score
   * is ever computed using another ticket's outcome or a later ticket's
   * data (see predict.resolve's header for how that's enforced). Splits by
   * `regime`, runs hypothesis.zTest per regime (H0: true outcome rate ==
   * average forecast) and corrects across regimes via
   * hypothesis.multipleComparison. filters: subject, modelId.
   */
  registerLensAction("predict", "walkForward", (ctx, artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const p = payloadOf(artifact, params);
      const clauses = ["o.score_brier IS NOT NULL"];
      const args = [];
      if (p.subject) { clauses.push("t.subject = ?"); args.push(p.subject); }
      if (p.modelId) { clauses.push("t.model_id = ?"); args.push(p.modelId); }
      const rows = db.prepare(`${TICKET_WITH_OUTCOME_SQL} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at ASC`).all(...args);
      const n = rows.length;
      if (n < 2) {
        return { ok: true, result: { n, message: "Insufficient resolved sample for a walk-forward report (need >= 2)." } };
      }

      // Expanding-window running Brier — ticket i's entry uses only tickets
      // [0..i], the definition of a causal (no-lookahead) replay.
      let cumBrier = 0;
      const runningBrierHistory = rows.map((row, i) => {
        const actual = toBinaryOutcome(row.actual_outcome) ?? 0;
        cumBrier += (row.point_probability - actual) ** 2;
        return { index: i + 1, ticketId: row.id, createdAt: row.created_at, runningBrier: r(cumBrier / (i + 1)) };
      });

      const byRegime = new Map();
      for (const row of rows) {
        const key = row.regime || "unspecified";
        if (!byRegime.has(key)) byRegime.set(key, []);
        byRegime.get(key).push(row);
      }

      const regimeResults = [];
      const pValueEntries = [];
      for (const [regime, regimeRows] of byRegime) {
        const rn = regimeRows.length;
        const pairs = regimeRows.map((row) => ({ predicted: row.point_probability, actual: toBinaryOutcome(row.actual_outcome) ?? 0 }));
        const brier = computeBrierScore(pairs);
        const accuracy = pairs.reduce((s, x) => s + x.actual, 0) / rn;
        const avgForecast = pairs.reduce((s, x) => s + x.predicted, 0) / rn;
        let pValue = null;
        if (rn >= 5) {
          // One-sample z-test: H0 true outcome rate == average forecast
          // probability for this regime. Bernoulli std dev from the
          // OBSERVED rate; a small epsilon floor avoids a zero-variance
          // z-test when accuracy is exactly 0 or 1.
          const stdDev = Math.max(Math.sqrt(accuracy * (1 - accuracy)), 1e-6);
          const zResult = callLensAction("hypothesis", "zTest", {
            sample: { mean: accuracy, stdDev, n: rn },
            populationMean: avgForecast,
            alternative: "two-sided",
          }, ctx);
          if (zResult?.ok) pValue = zResult.result.pValue;
        }
        regimeResults.push({ regime, n: rn, accuracy: r(accuracy), avgForecast: r(avgForecast), brier: r(brier), pValue });
        if (pValue !== null) pValueEntries.push({ regime, pValue });
      }

      let correction = null;
      if (pValueEntries.length >= 2) {
        const corrResult = callLensAction("hypothesis", "multipleComparison", {
          pValues: pValueEntries.map((e) => e.pValue),
          labels: pValueEntries.map((e) => e.regime),
          alpha: Number.isFinite(Number(p.alpha)) ? Number(p.alpha) : 0.05,
          method: "all",
        }, ctx);
        if (corrResult?.ok) correction = corrResult.result;
      }

      const overallPairs = rows.map((row) => ({ predicted: row.point_probability, actual: toBinaryOutcome(row.actual_outcome) ?? 0 }));
      const overallBrier = computeBrierScore(overallPairs);
      const overallBaseRate = overallPairs.reduce((s, x) => s + x.actual, 0) / n;

      const anySignificant = correction?.tests?.some((t) => t.fdrReject) || false;
      const result = {
        n,
        overall: { brierScore: r(overallBrier), baseRate: r(overallBaseRate) },
        regimes: regimeResults,
        correction,
        runningBrierHistory,
        temporalFirewall: "Each regime's Brier score and p-value are computed only from that regime's own tickets' frozen point_probability and their own resolution rows; the running Brier history is an expanding window (ticket i uses only tickets 0..i). No score in this report used any information dated after the ticket it scores was created.",
      };

      let dtuId = null;
      if (n >= WALKFORWARD_DTU_MIN_N && p.recordFinding !== false) {
        const kind = anySignificant ? "validated_pattern" : "rejected_hypothesis";
        dtuId = maybeRecordFinding(ctx, db, {
          kind,
          title: `Walk-forward ${anySignificant ? "validation" : "rejection"}: ${p.modelId || "all models"} / ${p.subject || "all subjects"} (n=${n})`,
          content: JSON.stringify(result, null, 2),
          metadata: { n, anySignificant, subject: p.subject || null, modelId: p.modelId || null, regimeCount: regimeResults.length },
        });
      }
      return { ok: true, result: { ...result, dtuId } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
