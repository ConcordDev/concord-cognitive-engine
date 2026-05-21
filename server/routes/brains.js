// server/routes/brains.js
//
// Brain-self-training inspection + admin endpoints.
//
//   GET  /api/brains/stats              — corpus + interaction counts per brain
//   GET  /api/brains/active             — currently-active model per brain
//   GET  /api/brains/:id/history        — recent model-version history
//   POST /api/brains/refresh            — admin-triggered immediate refresh
//                                         (otherwise runs daily 23:30-23:59)
//
// MLOps experiment-tracking surface (Lattice lens — vs Weights & Biases):
//   GET  /api/brains/runs               — training-run history (diffable)
//   GET  /api/brains/:id/eval-curve     — loss/accuracy curve across runs
//   POST /api/brains/:id/rollback       — pin/revert to a prior model
//   GET  /api/brains/schedule           — per-brain refresh cadence config
//   POST /api/brains/schedule           — set refresh cadence
//   GET  /api/brains/:id/corpus-sample  — actual DTU/interaction rows
//   GET  /api/brains/ab-tests           — list candidate A/B comparisons
//   POST /api/brains/ab-tests           — start a candidate A/B comparison
//   POST /api/brains/ab-tests/:id/conclude — pick a winner

import { Router } from "express";
import crypto from "node:crypto";

import { getBrainCorpusStats, buildPositiveCorpus } from "../lib/brain-training/interaction-log.js";
import { runDailyRefresh } from "../lib/brain-training/runner.js";

const VALID_BRAINS = ["conscious", "subconscious", "utility", "repair", "multimodal", "lattice"];
const VALID_CADENCE = ["daily", "weekly", "manual"];
const CADENCE_HOURS = { daily: 24, weekly: 168, manual: 0 };

function nowSec() { return Math.floor(Date.now() / 1000); }

/**
 * Persist a refresh run into brain_refresh_runs (one row per brain in
 * the runner result). Fail-safe — never throws.
 */
function recordRefreshRuns(db, runnerResult, { trigger, triggeredBy }) {
  if (!db || !runnerResult || !Array.isArray(runnerResult.results)) return [];
  const recorded = [];
  for (const r of runnerResult.results) {
    try {
      const prev = db.prepare(
        `SELECT eval_score FROM brain_refresh_runs
          WHERE brain_id = ? AND eval_score IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
      ).get(r.brainId);
      const status = r.ok === false ? "failed" : r.skipped ? "skipped" : "completed";
      const id = `brr_${crypto.randomBytes(8).toString("hex")}`;
      db.prepare(
        `INSERT INTO brain_refresh_runs
          (id, brain_id, trigger, status, corpus_size, eval_score, prev_score,
           swapped, model_name, base_model, detail_json, triggered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, r.brainId, trigger, status,
        Number.isFinite(r.corpusSize) ? r.corpusSize : 0,
        Number.isFinite(r.evalScore) ? r.evalScore : null,
        prev ? prev.eval_score : null,
        r.swapped ? 1 : 0,
        r.modelName ?? null,
        r.baseModel ?? null,
        JSON.stringify(r),
        triggeredBy ?? null,
      );
      recorded.push(id);
    } catch (_e) { /* fail-safe */ }
  }
  return recorded;
}

export default function createBrainsRouter({ db, requireAuth, requireRole }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;
  const adminGate = typeof requireRole === "function" ? requireRole("owner", "admin", "sovereign") : auth;

  // GET /api/brains/stats — public-ish counts (no individual prompts exposed).
  router.get("/stats", (_req, res) => {
    try {
      const stats = getBrainCorpusStats(db);
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/brains/active — currently-active model per brain.
  router.get("/active", (_req, res) => {
    try {
      const rows = db ? db.prepare(
        `SELECT brain_id, model_name, base_model, corpus_size, eval_score, created_at
           FROM brain_active_models
          WHERE active = 1
          ORDER BY brain_id`,
      ).all() : [];
      res.json({ ok: true, active: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/brains/:brainId/history — last N model versions for one brain.
  router.get("/:brainId/history", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
      const rows = db ? db.prepare(
        `SELECT id, model_name, base_model, corpus_size, eval_score, active, created_at, retired_at
           FROM brain_active_models
          WHERE brain_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
      ).all(req.params.brainId, limit) : [];
      res.json({ ok: true, brainId: req.params.brainId, history: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/brains/refresh — admin-only manual trigger. Bypasses the
  // 23:30-23:59 time-window gate. Body: { force: boolean } (default true).
  router.post("/refresh", adminGate, async (req, res) => {
    try {
      const force = req.body?.force !== false;
      const result = await runDailyRefresh(db, { force });
      const recorded = recordRefreshRuns(db, result, {
        trigger: "manual",
        triggeredBy: req.user?.id ?? null,
      });
      res.json({ ...result, recordedRuns: recorded });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: Training-run history (diffable over time) ──────────────
  // GET /api/brains/runs?brain=&limit=
  router.get("/runs", (req, res) => {
    try {
      if (!db) return res.json({ ok: true, runs: [] });
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 200);
      const brain = req.query.brain && VALID_BRAINS.includes(req.query.brain) ? req.query.brain : null;
      const rows = brain
        ? db.prepare(
            `SELECT id, brain_id, trigger, status, corpus_size, eval_score, prev_score,
                    swapped, model_name, base_model, triggered_by, created_at
               FROM brain_refresh_runs
              WHERE brain_id = ?
              ORDER BY created_at DESC LIMIT ?`,
          ).all(brain, limit)
        : db.prepare(
            `SELECT id, brain_id, trigger, status, corpus_size, eval_score, prev_score,
                    swapped, model_name, base_model, triggered_by, created_at
               FROM brain_refresh_runs
              ORDER BY created_at DESC LIMIT ?`,
          ).all(limit);
      const runs = rows.map((r) => ({
        ...r,
        delta: r.eval_score != null && r.prev_score != null
          ? Number((r.eval_score - r.prev_score).toFixed(4))
          : null,
      }));
      res.json({ ok: true, runs });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: Eval/metric curve per brain across runs ────────────────
  // GET /api/brains/:brainId/eval-curve?limit=
  router.get("/:brainId/eval-curve", (req, res) => {
    try {
      const brainId = req.params.brainId;
      if (!db) return res.json({ ok: true, brainId, curve: [] });
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
      const rows = db.prepare(
        `SELECT id, eval_score, corpus_size, swapped, model_name, created_at
           FROM brain_refresh_runs
          WHERE brain_id = ? AND eval_score IS NOT NULL
          ORDER BY created_at ASC LIMIT ?`,
      ).all(brainId, limit);
      const curve = rows.map((r, i) => ({
        run: i + 1,
        runId: r.id,
        evalScore: Number(r.eval_score.toFixed(4)),
        loss: Number((1 - r.eval_score).toFixed(4)),
        corpusSize: r.corpus_size,
        swapped: !!r.swapped,
        model: r.model_name,
        at: r.created_at,
      }));
      const best = curve.reduce((m, c) => (c.evalScore > m ? c.evalScore : m), 0);
      res.json({ ok: true, brainId, curve, bestEval: best, runCount: curve.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: Model version rollback ─────────────────────────────────
  // POST /api/brains/:brainId/rollback  body: { modelId }
  router.post("/:brainId/rollback", adminGate, (req, res) => {
    try {
      if (!db) return res.status(503).json({ ok: false, error: "no_db" });
      const brainId = req.params.brainId;
      const modelId = req.body?.modelId;
      if (!modelId) return res.status(400).json({ ok: false, error: "modelId required" });
      const target = db.prepare(
        `SELECT id, brain_id, model_name, active FROM brain_active_models WHERE id = ?`,
      ).get(modelId);
      if (!target) return res.status(404).json({ ok: false, error: "model_not_found" });
      if (target.brain_id !== brainId) {
        return res.status(400).json({ ok: false, error: "brain_mismatch" });
      }
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE brain_active_models SET active = 0, retired_at = unixepoch()
            WHERE brain_id = ? AND active = 1 AND id != ?`,
        ).run(brainId, modelId);
        db.prepare(
          `UPDATE brain_active_models SET active = 1, retired_at = NULL WHERE id = ?`,
        ).run(modelId);
      });
      tx();
      res.json({ ok: true, brainId, activeModel: target.model_name, modelId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: Refresh scheduling UI ──────────────────────────────────
  // GET /api/brains/schedule — per-brain cadence config.
  router.get("/schedule", (_req, res) => {
    try {
      if (!db) return res.json({ ok: true, schedule: [] });
      const rows = db.prepare(
        `SELECT brain_id, enabled, cadence, interval_hours, next_run_at, last_run_at, updated_at
           FROM brain_refresh_schedule ORDER BY brain_id`,
      ).all();
      const have = new Set(rows.map((r) => r.brain_id));
      // Surface a row for every brain even if not yet configured.
      const schedule = VALID_BRAINS.map((b) => {
        const row = rows.find((r) => r.brain_id === b);
        return row || { brain_id: b, enabled: 0, cadence: "manual", interval_hours: 0, next_run_at: null, last_run_at: null, updated_at: null };
      });
      void have;
      res.json({ ok: true, schedule });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/brains/schedule  body: { brain, enabled, cadence }
  router.post("/schedule", adminGate, (req, res) => {
    try {
      if (!db) return res.status(503).json({ ok: false, error: "no_db" });
      const brain = req.body?.brain;
      if (!brain || !VALID_BRAINS.includes(brain)) {
        return res.status(400).json({ ok: false, error: "invalid_brain" });
      }
      const cadence = VALID_CADENCE.includes(req.body?.cadence) ? req.body.cadence : "manual";
      const enabled = req.body?.enabled ? 1 : 0;
      const intervalHours = CADENCE_HOURS[cadence];
      const nextRun = enabled && intervalHours > 0 ? nowSec() + intervalHours * 3600 : null;
      db.prepare(
        `INSERT INTO brain_refresh_schedule
          (brain_id, enabled, cadence, interval_hours, next_run_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(brain_id) DO UPDATE SET
           enabled = excluded.enabled,
           cadence = excluded.cadence,
           interval_hours = excluded.interval_hours,
           next_run_at = excluded.next_run_at,
           updated_by = excluded.updated_by,
           updated_at = unixepoch()`,
      ).run(brain, enabled, cadence, intervalHours, nextRun, req.user?.id ?? null);
      res.json({ ok: true, brain, enabled: !!enabled, cadence, intervalHours, nextRunAt: nextRun });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: Corpus sample inspector ────────────────────────────────
  // GET /api/brains/:brainId/corpus-sample?limit= — actual rows that
  // feed a training run (positive, consented interactions).
  router.get("/:brainId/corpus-sample", (req, res) => {
    try {
      const brainId = req.params.brainId;
      if (!VALID_BRAINS.includes(brainId)) {
        return res.status(400).json({ ok: false, error: "invalid_brain" });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const corpus = buildPositiveCorpus(db, brainId, { max: limit });
      const sample = corpus.map((c, i) => {
        const promptText = typeof c.prompt === "string"
          ? c.prompt
          : Array.isArray(c.prompt)
            ? String(c.prompt.filter((m) => m?.role === "user").map((m) => m?.content).join(" "))
            : JSON.stringify(c.prompt ?? "");
        const responseText = typeof c.response === "string"
          ? c.response
          : JSON.stringify(c.response ?? "");
        return {
          idx: i + 1,
          domain: c.domain || "—",
          promptPreview: promptText.slice(0, 280),
          responsePreview: responseText.slice(0, 280),
          tokensIn: c.tokensIn ?? null,
          tokensOut: c.tokensOut ?? null,
        };
      });
      res.json({ ok: true, brainId, count: sample.length, sample });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Feature: A/B model comparison ───────────────────────────────────
  // GET /api/brains/ab-tests?brain=
  router.get("/ab-tests", (req, res) => {
    try {
      if (!db) return res.json({ ok: true, tests: [] });
      const brain = req.query.brain && VALID_BRAINS.includes(req.query.brain) ? req.query.brain : null;
      const rows = brain
        ? db.prepare(`SELECT * FROM brain_ab_tests WHERE brain_id = ? ORDER BY created_at DESC LIMIT 50`).all(brain)
        : db.prepare(`SELECT * FROM brain_ab_tests ORDER BY created_at DESC LIMIT 50`).all();
      res.json({ ok: true, tests: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/brains/ab-tests  body: { brain, candidateModel, trafficPct }
  router.post("/ab-tests", adminGate, (req, res) => {
    try {
      if (!db) return res.status(503).json({ ok: false, error: "no_db" });
      const brain = req.body?.brain;
      if (!brain || !VALID_BRAINS.includes(brain)) {
        return res.status(400).json({ ok: false, error: "invalid_brain" });
      }
      const candidate = req.body?.candidateModel;
      if (!candidate || typeof candidate !== "string") {
        return res.status(400).json({ ok: false, error: "candidateModel required" });
      }
      const trafficPct = Math.min(Math.max(parseInt(req.body?.trafficPct, 10) || 10, 1), 50);
      const control = db.prepare(
        `SELECT model_name FROM brain_active_models WHERE brain_id = ? AND active = 1`,
      ).get(brain);
      const controlModel = control?.model_name || "(base)";
      const id = `bab_${crypto.randomBytes(8).toString("hex")}`;
      db.prepare(
        `INSERT INTO brain_ab_tests
          (id, brain_id, candidate_model, control_model, traffic_pct, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, brain, candidate, controlModel, trafficPct, req.user?.id ?? null);
      res.json({ ok: true, id, brain, candidateModel: candidate, controlModel, trafficPct });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/brains/ab-tests/:id/conclude  body: { winner } ('candidate'|'control')
  router.post("/ab-tests/:id/conclude", adminGate, (req, res) => {
    try {
      if (!db) return res.status(503).json({ ok: false, error: "no_db" });
      const winner = req.body?.winner;
      if (winner !== "candidate" && winner !== "control") {
        return res.status(400).json({ ok: false, error: "winner must be candidate|control" });
      }
      const test = db.prepare(`SELECT * FROM brain_ab_tests WHERE id = ?`).get(req.params.id);
      if (!test) return res.status(404).json({ ok: false, error: "test_not_found" });
      if (test.status === "concluded") {
        return res.status(409).json({ ok: false, error: "already_concluded" });
      }
      db.prepare(
        `UPDATE brain_ab_tests SET status = 'concluded', winner = ?, concluded_at = unixepoch()
          WHERE id = ?`,
      ).run(winner, req.params.id);
      res.json({ ok: true, id: req.params.id, winner });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
