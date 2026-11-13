// Cockpit HTTP surface (GB-1500): failure counts (CKPT-01) and runs (CKPT-15).
import { failureCounts } from "../lib/cockpit/telemetry.js";
import { cockpitFlag } from "../lib/cockpit/flags.js";
import { getRunForUser, getStep, listSteps, listRunsForUser, countActiveRuns, createRun, updateRun, DEFAULT_BUDGET } from "../lib/cockpit/run-store.js";
import { planRun, materializePlan } from "../lib/cockpit/planner.js";
import { driveRun, runProgress } from "../lib/cockpit/engine.js";
import { applyDecision } from "../lib/cockpit/confirm.js";
import { budgetFromEnv, maxActiveRuns, raiseBudget } from "../lib/cockpit/budget.js";
import { defaultProfile } from "../lib/cockpit/model-caps.js";
import { subscribeRun, runEvent, stepEvent, stepLabel } from "../lib/cockpit/events.js";
import { scrubUserFacingToolNames } from "../lib/chat/tool-turn-reply.js";
import { startSSE } from "../lib/sse.js";

const ADMIN_ROLES = new Set(["owner", "admin", "sovereign", "founder"]);
const SURFACES = new Set(["chat", "conkay", "agent", "ask", "agents_lens", "long_task", "mcp"]);
const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function publicRun(run) {
  return {
    id: run.id, goal: run.goal, status: run.status, statusReason: run.statusReason, surface: run.surface,
    lensContext: run.lensContext, chatSessionId: run.chatSessionId, createdAt: run.createdAt, updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    usage: { toolCalls: run.usage?.toolCalls || 0, modelCalls: run.usage?.modelCalls || 0, humanInterventions: run.usage?.humanInterventions || 0 },
  };
}

export function publicStep(step) {
  const failed = step.status === "failed" || step.status === "skipped";
  return {
    id: step.id, seq: step.seq, label: stepLabel(step), goal: scrubUserFacingToolNames(step.goal), status: step.status,
    required: step.required, attempts: step.attempts, hasReceipt: !!step.receipt,
    summary: step.resultSummary?.text ? scrubUserFacingToolNames(step.resultSummary.text) : null,
    error: failed && step.errorText ? scrubUserFacingToolNames(step.errorText) : null,
  };
}

/**
 * @param {{ app: import("express").Express, db: object, makeDeps?: (run:object)=>object,
 *           lensActions?: Map, planDeps?: object }} deps
 */
export function mountCockpitRoutes({ app, db, makeDeps = null, lensActions = null, planDeps = null }) {
  app.get("/api/cockpit/failures", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
    const hours = Math.min(168, Math.max(1, Number.parseInt(req.query.hours, 10) || 24));
    const all = req.query.scope === "all" && ADMIN_ROLES.has(String(req.user?.role || "").toLowerCase());
    const sinceSec = Math.floor(Date.now() / 1000) - hours * 3600;
    const out = failureCounts(db, { userId: all ? null : userId, sinceSec });
    if (!out.ok) return res.status(503).json(out);
    return res.json({ ...out, hours, scope: all ? "all" : "self" });
  });

  // Every run route: flag on, signed in, and only the caller's own runs.
  const guard = (req, res) => {
    if (!cockpitFlag("RUNS")) { res.status(404).json({ ok: false, error: "cockpit_disabled" }); return null; }
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ ok: false, error: "auth_required" }); return null; }
    return String(userId);
  };
  const ownRun = (req, res, userId) => {
    const run = getRunForUser(db, req.params.id, userId);
    if (!run) { res.status(404).json({ ok: false, error: "not_found" }); return null; }
    return run;
  };
  const drive = (run) => {
    if (!makeDeps) return;
    const deps = makeDeps(run);
    driveRun({ db, runId: run.id, owner: `route:${process.pid}`, deps, deadlineMs: Date.now() + 25000 }).catch(() => {});
  };

  app.post("/api/cockpit/runs", async (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const goal = String(req.body?.goal || "").trim();
    if (!goal) return res.status(400).json({ ok: false, error: "empty_goal" });
    if (countActiveRuns(db, userId) >= maxActiveRuns()) return res.status(429).json({ ok: false, error: "too_many_runs" });
    try {
      const profile = defaultProfile();
      const lensContext = req.body?.lensContext ? String(req.body.lensContext).slice(0, 80) : null;
      const plan = await planRun({ db, userId, goal, lensContext, profile, lensActions, deps: planDeps || undefined });
      if (!plan.ok) return res.status(400).json({ ok: false, error: plan.reason || "no_plan" });
      const created = createRun(db, {
        userId, surface: SURFACES.has(req.body?.surface) ? req.body.surface : "chat", goal,
        chatSessionId: req.body?.chatSessionId ? String(req.body.chatSessionId) : null, lensContext, modelProfile: profile, budget: budgetFromEnv(),
      });
      if (!created.ok) return res.status(503).json({ ok: false, error: created.reason });
      const steps = materializePlan(db, created.run.id, 1, plan.steps);
      drive(created.run);
      return res.status(201).json({ ok: true, run: publicRun(created.run), steps: steps.map(publicStep), source: plan.source });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "run_failed", detail: scrubUserFacingToolNames(String(e?.message || e)).slice(0, 200) });
    }
  });

  app.get("/api/cockpit/runs", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    return res.json({ ok: true, runs: listRunsForUser(db, userId, { limit: 20 }).map(publicRun) });
  });

  app.get("/api/cockpit/runs/:id", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    const steps = listSteps(db, run.id);
    return res.json({ ok: true, run: publicRun(run), steps: steps.map(publicStep), progress: runProgress(steps) });
  });

  app.get("/api/cockpit/runs/:id/events", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    startSSE(res);
    const send = (e) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { /* closed */ } };
    const steps = listSteps(db, run.id);
    send(runEvent(run, steps));
    for (const s of steps) send(stepEvent(run, s, steps.length));
    if (TERMINAL.has(run.status)) { res.end(); return undefined; }
    const unsub = subscribeRun(run.id, (e) => {
      send(e);
      if (e.type === "cockpit:run" && TERMINAL.has(e.status)) { unsub(); res.end(); }
    });
    req.on("close", unsub);
    return undefined;
  });

  app.post("/api/cockpit/runs/:id/decision", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    const step = getStep(db, String(req.body?.stepId || ""));
    if (!step || step.runId !== run.id) return res.status(409).json({ ok: false, error: "not_waiting" });
    const r = applyDecision(db, {
      run, step, userId, decision: String(req.body?.decision || ""), editedArgs: req.body?.editedArgs || null,
      dontAskAgain: req.body?.dontAskAgain === true, answer: req.body?.answer ?? null, lensActions,
    });
    if (!r.ok) {
      const code = r.reason === "not_waiting" ? 409 : 400;
      return res.status(code).json({ ok: false, error: r.reason, ...(r.errors ? { errors: r.errors } : {}) });
    }
    const fresh = getRunForUser(db, run.id, userId);
    drive(fresh);
    return res.json({ ok: true, run: publicRun(fresh) });
  });

  app.post("/api/cockpit/runs/:id/pause", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    if (TERMINAL.has(run.status)) return res.status(409).json({ ok: false, error: "finished" });
    updateRun(db, run.id, { status: "paused", statusReason: "user", resumeAt: null });
    return res.json({ ok: true, run: publicRun(getRunForUser(db, run.id, userId)) });
  });

  app.post("/api/cockpit/runs/:id/resume", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    if (run.status !== "paused") return res.status(409).json({ ok: false, error: "not_paused" });
    const done = listSteps(db, run.id).filter((s) => s.status === "done").length;
    updateRun(db, run.id, { status: "running", statusReason: null, resumeAt: null, budget: raiseBudget(run, done, DEFAULT_BUDGET) });
    const fresh = getRunForUser(db, run.id, userId);
    drive(fresh);
    return res.json({ ok: true, run: publicRun(fresh) });
  });

  app.post("/api/cockpit/runs/:id/cancel", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    if (TERMINAL.has(run.status)) return res.status(409).json({ ok: false, error: "finished" });
    updateRun(db, run.id, { status: "cancelled", finishedAt: Math.floor(Date.now() / 1000) });
    return res.json({ ok: true, run: publicRun(getRunForUser(db, run.id, userId)) });
  });

  app.get("/api/cockpit/runs/:id/steps/:stepId/receipt", (req, res) => {
    const userId = guard(req, res);
    if (!userId) return undefined;
    const run = ownRun(req, res, userId);
    if (!run) return undefined;
    const step = getStep(db, req.params.stepId);
    if (!step || step.runId !== run.id || !step.receipt) return res.status(404).json({ ok: false, error: "no_receipt" });
    return res.json({ ok: true, receipt: step.receipt });
  });
}
