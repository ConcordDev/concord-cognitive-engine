/**
 * Emergent Features API Routes
 *
 * Wires all new emergent modules into REST endpoints:
 *
 * Ghost Threads:
 *   POST /api/emergent/ghost-threads/run       — trigger ghost thread
 *   GET  /api/emergent/ghost-threads/insights   — query insights
 *   POST /api/emergent/ghost-threads/surface     — surface an insight
 *   GET  /api/emergent/ghost-threads/relevant    — find relevant insights for query
 *   GET  /api/emergent/ghost-threads/metrics     — get metrics
 *
 * User Constitution:
 *   GET    /api/emergent/constitution/rules       — get user's rules
 *   POST   /api/emergent/constitution/rules       — add a rule
 *   PUT    /api/emergent/constitution/rules/:id   — update a rule
 *   DELETE /api/emergent/constitution/rules/:id   — remove a rule
 *   POST   /api/emergent/constitution/check       — check output against rules
 *   GET    /api/emergent/constitution/presets      — list presets
 *   POST   /api/emergent/constitution/presets/:id  — apply preset
 *   GET    /api/emergent/constitution/violations   — get violation history
 *
 * Scenario Engine:
 *   POST /api/emergent/scenarios                  — create scenario
 *   GET  /api/emergent/scenarios                  — list user scenarios
 *   GET  /api/emergent/scenarios/:id              — get scenario
 *   POST /api/emergent/scenarios/:id/branch       — add branch
 *   POST /api/emergent/scenarios/:id/run          — run simulation
 *   GET  /api/emergent/scenarios/:id/compare      — compare branches
 *
 * Cognitive Fingerprint:
 *   GET    /api/emergent/fingerprint              — get my fingerprint summary
 *   POST   /api/emergent/fingerprint/query        — record a query
 *   POST   /api/emergent/fingerprint/prediction   — record a prediction
 *   DELETE /api/emergent/fingerprint              — delete my fingerprint
 *
 * Cross-Lens Pipelines:
 *   GET  /api/emergent/pipelines/templates        — list templates
 *   POST /api/emergent/pipelines                  — create pipeline
 *   GET  /api/emergent/pipelines                  — list my pipelines
 *   GET  /api/emergent/pipelines/:id              — get pipeline
 *   POST /api/emergent/pipelines/:id/advance      — advance to next stage
 *   POST /api/emergent/pipelines/:id/start        — start pipeline
 *   POST /api/emergent/pipelines/:id/pause        — pause pipeline
 *   POST /api/emergent/pipelines/:id/resume       — resume pipeline
 *
 * Dream Cycle:
 *   POST /api/emergent/dream-cycle/run            — trigger dream cycle
 *   GET  /api/emergent/dream-cycle/state           — get cycle state
 *   GET  /api/emergent/dream-cycle/brief           — get latest morning brief
 *   GET  /api/emergent/dream-cycle/metrics         — get metrics
 */

import { Router } from "express";
import logger from "../logger.js";

// Ghost Threads
import {
  runGhostThread,
  surfaceInsight,
  queryInsights,
  findRelevantInsights,
  getGhostThreadMetrics,
} from "../emergent/ghost-threads.js";

// User Constitution
import {
  addUserRule,
  removeUserRule,
  toggleUserRule,
  getUserRules,
  updateUserRule,
  checkOutput,
  getViolationHistory,
  getConstitutionMetrics,
  applyPreset,
  RULE_PRESETS,
} from "../emergent/user-constitution.js";

// Scenario Engine
import {
  createScenario,
  getScenario,
  listUserScenarios,
  addBranch,
  runScenario,
  compareBranches,
  getScenarioMetrics,
} from "../emergent/scenario-engine.js";

// Cognitive Fingerprint
import {
  getFingerprintSummary,
  recordQuery,
  recordPrediction,
  deleteFingerprint,
} from "../emergent/cognitive-fingerprint.js";

// Cross-Lens Pipelines
import {
  createPipeline,
  startPipeline,
  advancePipeline,
  pausePipeline,
  resumePipeline,
  getPipeline,
  listUserPipelines,
  listTemplates as listPipelineTemplates,
  getPipelineMetrics,
} from "../emergent/cross-lens-pipeline.js";

// Dream Cycle
import {
  runDreamCycle,
  getDreamCycleState,
  getDreamCycleMetrics,
  getLatestMorningBrief,
} from "../emergent/dream-cycle.js";

/**
 * @param {object} opts
 * @param {object} opts.STATE - The emergent state
 * @param {Function} [opts.requireAuth] - Auth middleware
 */
export default function createEmergentFeaturesRouter({ STATE, requireAuth } = {}) {
  const router = Router();

  function _userId(req) {
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null;
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn("[emergent-features] error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("required") || err.message.includes("Invalid") ? 400
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ── Ghost Threads ──────────────────────────────────────────────────────────

  router.post("/ghost-threads/run", auth, wrap((_req, res) => {
    const result = runGhostThread(STATE);
    res.json({ ok: true, ...result });
  }));

  router.get("/ghost-threads/insights", wrap((req, res) => {
    const { pattern, surfaced, minScore, limit } = req.query;
    const insights = queryInsights({
      pattern,
      surfaced: surfaced === "true" ? true : surfaced === "false" ? false : null,
      minScore: minScore ? parseFloat(minScore) : 0,
      limit: limit ? parseInt(limit) : 20,
    });
    res.json({ ok: true, insights, count: insights.length });
  }));

  router.post("/ghost-threads/surface", auth, wrap((req, res) => {
    const result = surfaceInsight(req.body.insightId, req.body.context);
    res.json({ ok: true, ...result });
  }));

  router.get("/ghost-threads/relevant", auth, wrap((req, res) => {
    const { query, tags } = req.query;
    const insights = findRelevantInsights(query || "", tags ? tags.split(",") : []);
    res.json({ ok: true, insights, count: insights.length });
  }));

  router.get("/ghost-threads/metrics", wrap((_req, res) => {
    res.json({ ok: true, metrics: getGhostThreadMetrics() });
  }));

  // ── User Constitution ──────────────────────────────────────────────────────

  router.get("/constitution/rules", auth, wrap((req, res) => {
    const rules = getUserRules(_userId(req));
    res.json({ ok: true, rules, count: rules.length });
  }));

  router.post("/constitution/rules", auth, wrap((req, res) => {
    const result = addUserRule(_userId(req), req.body);
    res.status(result.ok ? 201 : 400).json(result);
  }));

  router.put("/constitution/rules/:id", auth, wrap((req, res) => {
    const result = updateUserRule(_userId(req), req.params.id, req.body);
    res.json(result);
  }));

  router.delete("/constitution/rules/:id", auth, wrap((req, res) => {
    const result = removeUserRule(_userId(req), req.params.id);
    res.json(result);
  }));

  router.post("/constitution/rules/:id/toggle", auth, wrap((req, res) => {
    const result = toggleUserRule(_userId(req), req.params.id, req.body.enabled);
    res.json(result);
  }));

  router.post("/constitution/check", auth, wrap((req, res) => {
    const { output, lens, domain, tags } = req.body;
    const result = checkOutput(_userId(req), output, { lens, domain, tags });
    res.json({ ok: true, ...result });
  }));

  router.get("/constitution/presets", wrap((_req, res) => {
    const presets = Object.entries(RULE_PRESETS).map(([id, p]) => ({
      id, name: p.name, description: p.description, ruleCount: p.rules.length,
    }));
    res.json({ ok: true, presets });
  }));

  router.post("/constitution/presets/:id", auth, wrap((req, res) => {
    const result = applyPreset(_userId(req), req.params.id);
    res.json(result);
  }));

  router.get("/constitution/violations", auth, wrap((req, res) => {
    const history = getViolationHistory(_userId(req), parseInt(req.query.limit) || 20);
    res.json({ ok: true, violations: history, count: history.length });
  }));

  router.get("/constitution/metrics", wrap((_req, res) => {
    res.json({ ok: true, metrics: getConstitutionMetrics() });
  }));

  // ── Scenario Engine ────────────────────────────────────────────────────────

  router.post("/scenarios", auth, wrap((req, res) => {
    const scenario = createScenario({ ...req.body, userId: _userId(req) });
    res.status(201).json({ ok: true, scenario });
  }));

  router.get("/scenarios", auth, wrap((req, res) => {
    const { domain, state, limit } = req.query;
    const scenarios = listUserScenarios(_userId(req), { domain, state, limit: limit ? parseInt(limit) : 20 });
    res.json({ ok: true, scenarios, count: scenarios.length });
  }));

  router.get("/scenarios/metrics", wrap((_req, res) => {
    res.json({ ok: true, metrics: getScenarioMetrics() });
  }));

  router.get("/scenarios/:id", wrap((req, res) => {
    const scenario = getScenario(req.params.id);
    if (!scenario) return res.status(404).json({ ok: false, error: "Scenario not found" });
    res.json({ ok: true, scenario });
  }));

  router.post("/scenarios/:id/branch", auth, wrap((req, res) => {
    const result = addBranch(req.params.id, req.body);
    res.json({ ok: true, ...result });
  }));

  router.post("/scenarios/:id/run", auth, wrap((req, res) => {
    const result = runScenario(req.params.id, req.body);
    res.json({ ok: true, scenario: result });
  }));

  router.get("/scenarios/:id/compare", wrap((req, res) => {
    const { branchA, branchB } = req.query;
    const result = compareBranches(req.params.id, branchA, branchB);
    res.json({ ok: true, ...result });
  }));

  // ── Cognitive Fingerprint ──────────────────────────────────────────────────

  router.get("/fingerprint", auth, wrap((req, res) => {
    const summary = getFingerprintSummary(_userId(req));
    res.json({ ok: true, fingerprint: summary });
  }));

  router.post("/fingerprint/query", auth, wrap((req, res) => {
    recordQuery(_userId(req), req.body);
    res.json({ ok: true });
  }));

  router.post("/fingerprint/prediction", auth, wrap((req, res) => {
    recordPrediction(_userId(req), req.body);
    res.json({ ok: true });
  }));

  router.delete("/fingerprint", auth, wrap((req, res) => {
    const result = deleteFingerprint(_userId(req));
    res.json(result);
  }));

  // ── Cross-Lens Pipelines ───────────────────────────────────────────────────

  router.get("/pipelines/templates", wrap((_req, res) => {
    const templates = listPipelineTemplates();
    res.json({ ok: true, templates, count: templates.length });
  }));

  router.post("/pipelines", auth, wrap((req, res) => {
    const pipeline = createPipeline({ ...req.body, userId: _userId(req) });
    res.status(201).json({ ok: true, pipeline });
  }));

  router.get("/pipelines", auth, wrap((req, res) => {
    const { state, templateId, limit } = req.query;
    const pipelines = listUserPipelines(_userId(req), { state, templateId, limit: limit ? parseInt(limit) : 20 });
    res.json({ ok: true, pipelines, count: pipelines.length });
  }));

  router.get("/pipelines/metrics", wrap((_req, res) => {
    res.json({ ok: true, metrics: getPipelineMetrics() });
  }));

  router.get("/pipelines/:id", wrap((req, res) => {
    const pipeline = getPipeline(req.params.id);
    if (!pipeline) return res.status(404).json({ ok: false, error: "Pipeline not found" });
    res.json({ ok: true, pipeline });
  }));

  router.post("/pipelines/:id/start", auth, wrap((req, res) => {
    const result = startPipeline(req.params.id);
    res.json({ ok: true, pipeline: result });
  }));

  router.post("/pipelines/:id/advance", auth, wrap((req, res) => {
    const result = advancePipeline(req.params.id, req.body.stageOutput);
    res.json({ ok: true, pipeline: result });
  }));

  router.post("/pipelines/:id/pause", auth, wrap((req, res) => {
    const result = pausePipeline(req.params.id);
    res.json({ ok: true, pipeline: result });
  }));

  router.post("/pipelines/:id/resume", auth, wrap((req, res) => {
    const result = resumePipeline(req.params.id);
    res.json({ ok: true, pipeline: result });
  }));

  // ── Dream Cycle ────────────────────────────────────────────────────────────

  router.post("/dream-cycle/run", auth, wrap(async (_req, res) => {
    const result = await runDreamCycle(STATE);
    res.json(result);
  }));

  router.get("/dream-cycle/state", wrap((_req, res) => {
    res.json({ ok: true, ...getDreamCycleState() });
  }));

  router.get("/dream-cycle/brief", wrap((_req, res) => {
    const brief = getLatestMorningBrief();
    res.json({ ok: true, brief });
  }));

  router.get("/dream-cycle/metrics", wrap((_req, res) => {
    res.json({ ok: true, metrics: getDreamCycleMetrics() });
  }));

  return router;
}
