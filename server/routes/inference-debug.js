// server/routes/inference-debug.js
// Debug and observability routes for inference traces, threads, and cost attribution.
// Mount at: app.use('/api/inference', createInferenceDebugRouter({ db, getSpans }))
//
// Three-gate note: /api/inference is likely already gated. Verify publicReadDomains
// has 'traces', 'threads', 'spans', 'costs' entries.

import { Router } from "express";
import { getSpans } from "../lib/inference/tracer.js";
import { aggregateCosts, computeInferenceCost } from "../lib/inference/cost-model.js";
import {
  listThreads,
  getThread,
  listCheckpoints,
} from "../lib/inference/thread-manager.js";
import {
  listSandboxes,
  getSandbox,
} from "../lib/tools/sandbox-manager.js";

const ALLOWED_SQL_TABLES = new Set(["inference_spans"]);
const DISALLOWED_SQL = /\b(users|sessions|dtus|personal_locker|messaging_bindings|DROP|DELETE|INSERT|UPDATE|ATTACH|PRAGMA)\b/i;

export function createInferenceDebugRouter({ db }) {
  const router = Router();

  // ─── TRACES ────────────────────────────────────────────────────────────────

  router.get("/traces", (req, res) => {
    const { limit = 30, inferenceId, minLatency } = req.query;
    const spans = getSpans(inferenceId);

    // Group spans by inferenceId
    const byId = new Map();
    for (const span of spans) {
      if (!byId.has(span.inferenceId)) byId.set(span.inferenceId, []);
      byId.get(span.inferenceId).push(span);
    }

    let traces = [...byId.entries()].map(([id, spans]) => {
      const finishSpan = spans.find(s => s.type === "finish");
      const failureSpan = spans.find(s => s.type === "failure");
      return {
        inferenceId: id,
        spans,
        summary: {
          brainUsed: finishSpan?.data?.brainUsed,
          latencyMs: finishSpan?.data?.latencyMs,
          tokensIn: finishSpan?.data?.tokensIn,
          tokensOut: finishSpan?.data?.tokensOut,
          stepCount: finishSpan?.data?.stepCount,
          failed: Boolean(failureSpan),
          terminated: finishSpan?.data?.terminated,
        },
      };
    });

    // Filters
    if (minLatency) {
      traces = traces.filter(t => (t.summary.latencyMs || 0) >= Number(minLatency));
    }

    // Most recent first
    traces.sort((a, b) => {
      const aTime = a.spans[0]?.timestamp || 0;
      const bTime = b.spans[0]?.timestamp || 0;
      return bTime - aTime;
    });

    res.json({ ok: true, traces: traces.slice(0, Number(limit)) });
  });

  router.get("/traces/:inferenceId", (req, res) => {
    const spans = getSpans(req.params.inferenceId);
    if (!spans.length) return res.status(404).json({ ok: false, error: "trace_not_found" });
    res.json({ ok: true, inferenceId: req.params.inferenceId, spans });
  });

  // ─── SQL OVER SPANS ─────────────────────────────────────────────────────────

  router.get("/spans", (req, res) => {
    if (!db) return res.json({ ok: true, spans: [] });
    const { brain, type, limit = 100, since, caller } = req.query;

    const conditions = [];
    const params = [];

    if (brain) { conditions.push("brain_used = ?"); params.push(brain); }
    if (type) { conditions.push("span_type = ?"); params.push(type); }
    if (since) { conditions.push("recorded_at >= ?"); params.push(since); }
    if (caller) { conditions.push("caller_id LIKE ?"); params.push(`%${caller}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
      const rows = db.prepare(`
        SELECT * FROM inference_spans ${where} ORDER BY recorded_at DESC LIMIT ?
      `).all(...params, Number(limit));
      res.json({ ok: true, spans: rows });
    } catch (err) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/spans/query", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });

    const { sql } = req.body;
    if (!sql || typeof sql !== "string") return res.status(400).json({ ok: false, error: "sql_required" });

    // Security: only SELECT, only inference_spans table
    if (DISALLOWED_SQL.test(sql)) {
      return res.status(400).json({ ok: false, error: "query_not_allowed: only SELECT on inference_spans is permitted" });
    }
    if (!sql.trim().toUpperCase().startsWith("SELECT")) {
      return res.status(400).json({ ok: false, error: "only_select_allowed" });
    }

    try {
      const rows = db.prepare(sql).all();
      res.json({ ok: true, rows, count: rows.length });
    } catch (err) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  router.get("/spans/stats", (req, res) => {
    if (!db) return res.json({ ok: true, stats: {} });
    try {
      const byBrain = db.prepare(`
        SELECT brain_used, COUNT(*) as count, AVG(latency_ms) as avg_latency_ms,
               SUM(tokens_in) as total_tokens_in, SUM(tokens_out) as total_tokens_out
        FROM inference_spans WHERE span_type = 'finish'
        GROUP BY brain_used ORDER BY count DESC
      `).all();

      const recentFailures = db.prepare(`
        SELECT inference_id, error, recorded_at FROM inference_spans
        WHERE span_type = 'failure' ORDER BY recorded_at DESC LIMIT 10
      `).all();

      res.json({ ok: true, byBrain, recentFailures });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ─── COSTS ──────────────────────────────────────────────────────────────────

  router.get("/costs", (req, res) => {
    if (!db) return res.json({ ok: true, totalUsd: 0, byModel: {}, byLens: {}, byCaller: {} });

    const { days = 30, userId } = req.query;
    const since = new Date(Date.now() - Number(days) * 86400000).toISOString();

    try {
      let query = `SELECT model_used, tokens_in, tokens_out, lens_id, caller_id
                   FROM inference_spans WHERE span_type = 'finish' AND recorded_at >= ?`;
      const params = [since];

      if (userId) {
        query += ` AND caller_id LIKE ?`;
        params.push(`%${userId}%`);
      }

      const rows = db.prepare(query).all(...params);
      const breakdown = aggregateCosts(rows);

      res.json({ ok: true, days: Number(days), ...breakdown });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ─── THREADS ────────────────────────────────────────────────────────────────

  router.get("/threads", (req, res) => {
    if (!db) return res.json({ ok: true, threads: [] });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const { status } = req.query;
    const threads = listThreads(db, userId, { status });
    res.json({ ok: true, threads });
  });

  router.get("/threads/:threadId", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const userId = req.user?.id;
    const thread = getThread(db, req.params.threadId, userId);
    if (!thread) return res.status(404).json({ ok: false, error: "thread_not_found" });
    res.json({ ok: true, thread });
  });

  router.get("/threads/:threadId/checkpoints", (req, res) => {
    if (!db) return res.json({ ok: true, checkpoints: [] });
    const userId = req.user?.id;
    const thread = getThread(db, req.params.threadId, userId);
    if (!thread) return res.status(404).json({ ok: false, error: "thread_not_found" });
    const checkpoints = listCheckpoints(db, req.params.threadId);
    res.json({ ok: true, checkpoints });
  });

  // ─── SANDBOXES ──────────────────────────────────────────────────────────────

  router.get("/sandboxes", (req, res) => {
    if (!db) return res.json({ ok: true, sandboxes: [] });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const sandboxes = listSandboxes(db, userId);
    res.json({ ok: true, sandboxes });
  });

  router.get("/sandboxes/:sandboxId", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const userId = req.user?.id;
    const sandbox = getSandbox(db, req.params.sandboxId, userId);
    if (!sandbox) return res.status(404).json({ ok: false, error: "sandbox_not_found" });
    res.json({ ok: true, sandbox });
  });

  return router;
}
