/**
 * Emergent Agent Governance API routes — extracted from server.js
 * Mounted at /api/emergent
 */
import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { castVote, tallyVotes } from "../lib/governance/voting.js";
import { processProposalConflicts, addRuleWithConflictCheck } from "../lib/governance/conflict-detector.js";
import { evaluateRulesForAction } from "../lib/governance/rule-enforcement.js";

export default function createEmergentRouter({ makeCtx, runMacro }) {
  const router = express.Router();

  // ── Async Safety Net for Router ──
  // Patches router methods to catch unhandled promise rejections in async handlers.
  // Without this, any async handler that throws crashes the process via unhandledRejection.
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    const orig = router[method].bind(router);
    router[method] = function (routePath, ...handlers) {
      const wrapped = handlers.map(fn => {
        if (fn && fn.constructor?.name === "AsyncFunction") {
          return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(err => {
              const msg = String(err?.message || err);
              if (!res.headersSent) {
                const status = msg.startsWith("forbidden") ? 403
                  : (msg.includes("not_found") || msg.includes("not found")) ? 404 : 500;
                res.status(status).json({ ok: false, error: msg });
              }
            });
          };
        }
        return fn;
      });
      return orig(routePath, ...wrapped);
    };
  }

  // Emergent management
  router.post("/register", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "register", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/list", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "list", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  // Status MUST come before /:id catch-all or /status matches id="status"
  router.get("/status", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "status", {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "get", { id: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.post("/:id/deactivate", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "deactivate", { id: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  // Dialogue sessions
  router.post("/session/create", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "session.create", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/session/turn", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "session.turn", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/session/complete", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "session.complete", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/session/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "session.get", { sessionId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.post("/session/run", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "session.run", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Governance / promotion
  router.post("/review", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "review", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/specialize", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "specialize", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/outreach", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "outreach", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/consent/check", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "consent.check", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Growth
  router.post("/growth/patterns", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "growth.patterns", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/growth/distill", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "growth.distill", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Audit (status route moved above /:id catch-all to prevent route shadowing)
  router.get("/gate/trace", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "gate.trace", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/bundle/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "bundle.get", { bundleId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/patterns", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "patterns", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reputation/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reputation", { emergentId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/schema", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "schema", {}, makeCtx(req));
    return res.json(out);
  }));

  // Lattice operations (READ / PROPOSE / COMMIT)
  router.get("/lattice/read/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.read", { dtuId: req.params.id, readerId: req.query.readerId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/lattice/staging/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.readStaging", { proposalId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/lattice/query", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.query", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/lattice/propose/dtu", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.proposeDTU", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/lattice/propose/edit", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.proposeEdit", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/lattice/propose/edge", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.proposeEdge", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/lattice/commit", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.commit", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/lattice/reject", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.reject", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/lattice/proposals", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.proposals", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/lattice/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "lattice.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // Edge semantics
  router.post("/edge/create", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.create", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/edge/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.get", { edgeId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/edge/query", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.query", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/edge/:id/update", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.update", { edgeId: req.params.id, ...req.body }, makeCtx(req));
    return res.json(out);
  }));

  router.post("/edge/:id/remove", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.remove", { edgeId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/edge/neighborhood/:nodeId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.neighborhood", { nodeId: req.params.nodeId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/edge/paths", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.paths", { fromId: req.query.fromId, toId: req.query.toId, maxDepth: req.query.maxDepth ? parseInt(req.query.maxDepth, 10) : undefined }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/edge/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "edge.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // Activation / attention
  router.post("/activation/activate", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.activate", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/activation/spread", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.spread", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/activation/working-set/:sessionId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.workingSet", { sessionId: req.params.sessionId, k: req.query.k ? parseInt(req.query.k, 10) : undefined }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/activation/global", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.global", { k: req.query.k ? parseInt(req.query.k, 10) : undefined }, makeCtx(req));
    return res.json(out);
  }));

  router.post("/activation/decay", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.decay", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/activation/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "activation.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // Conflict-safe merge
  router.post("/merge/apply", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "merge.apply", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/merge/resolve", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "merge.resolve", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/merge/conflicts/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "merge.conflicts", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/merge/timestamps/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "merge.timestamps", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/merge/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "merge.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // Lattice journal
  router.post("/journal/append", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.append", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/by-type/:eventType", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.byType", { eventType: req.params.eventType, ...req.query }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/by-entity/:entityId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.byEntity", { entityId: req.params.entityId, ...req.query }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/by-session/:sessionId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.bySession", { sessionId: req.params.sessionId, ...req.query }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/recent", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.recent", { count: req.query.count ? parseInt(req.query.count, 10) : undefined }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/explain/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.explain", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/journal/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/journal/compact", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "journal.compact", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Livable reality
  router.get("/reality/continuity/:emergentId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.continuity", { emergentId: req.params.emergentId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/cost/:emergentId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.cost", { emergentId: req.params.emergentId, domain: req.query.domain }, makeCtx(req));
    return res.json(out);
  }));

  router.post("/reality/consequences", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.consequences", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/needs", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.needs", {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/suggest/:emergentId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.suggest", { emergentId: req.params.emergentId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/sociality", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.sociality", { emergentA: req.query.emergentA, emergentB: req.query.emergentB }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/explain/proposal/:proposalId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.explainProposal", { proposalId: req.params.proposalId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/explain/trust/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.explainTrust", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/reality/belonging/:emergentId", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "reality.belonging", { emergentId: req.params.emergentId }, makeCtx(req));
    return res.json(out);
  }));

  // Cognition scheduler
  router.post("/scheduler/item", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.createItem", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/scan", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.scan", {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/queue", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.queue", {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/dequeue", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.dequeue", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/expire", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.expire", {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/rescore", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.rescore", {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/weights", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.updateWeights", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/budget", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.budget", {}, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/budget/check", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.checkBudget", req.query || {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/budget/update", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.updateBudget", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/allocate", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.allocate", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/allocation/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.allocation", { allocationId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/active", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.active", {}, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/turn", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.recordTurn", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/proposal", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.recordProposal", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.post("/scheduler/complete", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.complete", req.body, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/completed", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.completed", { limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined }, makeCtx(req));
    return res.json(out);
  }));

  router.get("/scheduler/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("emergent", "scheduler.metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // ── Constitutional Governance ──────────────────────────────────────────────

  router.post("/proposals/:id/vote", asyncHandler(async (req, res) => {
    const { voteType } = req.body;
    const userId = req.user?.id ?? req.body.userId;
    const result = castVote(req.params.id, userId, voteType);
    return res.json({ ok: true, ...result });
  }));

  router.get("/proposals/:id/tally", asyncHandler(async (req, res) => {
    // Pull votes from STATE via macro; fall back to empty list if unavailable
    let votes = [];
    try {
      const out = await runMacro("emergent", "lattice.readStaging", { proposalId: req.params.id }, makeCtx(req));
      votes = out?.votes ?? out?.data?.votes ?? [];
    } catch { /* tally on empty is still valid */ }
    const tally = tallyVotes(votes, {});
    return res.json({ ok: true, tally });
  }));

  router.post("/proposals/:id/conflicts", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const result = processProposalConflicts(ctx.STATE, req.body);
    return res.json({ ok: true, ...result });
  }));

  router.post("/rules/add", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const result = await addRuleWithConflictCheck(ctx.STATE, req.body);
    return res.json({ ok: true, ...result });
  }));

  router.post("/actions/evaluate", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const result = evaluateRulesForAction(ctx.STATE, req.body.action);
    return res.json({ ok: true, ...result });
  }));

  return router;
}
