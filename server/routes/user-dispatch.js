/**
 * User Dispatch Router — Non-sovereign action dispatch for user-facing lenses.
 *
 * Exposes POST /api/run with the same { action, target, data } pattern as
 * sovereign-emergent/decree, but accessible to any authenticated user.
 *
 * Only covers the explicit allowlist of user-facing actions:
 *   - Agents (agent-list, agent-create, agent-pause, agent-resume, etc.)
 *   - Research (research, research-deep, research-queue, research-status, etc.)
 *   - Hypothesis (hypothesis-list, hypothesis-create, hypothesis-evidence, etc.)
 *
 * System-level sovereign operations (DTU management, GC, reproduction, species,
 * simulations, etc.) remain exclusively in /api/sovereign/decree.
 */
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import logger from "../logger.js";

const ALLOWED_ACTIONS = new Set([
  // Agent operations
  "agent-list", "agent-create", "agent-pause", "agent-resume", "agent-destroy",
  "agent-findings", "agent-status", "agents-freeze", "agents-thaw",
  // Research operations
  "research", "research-deep", "research-queue", "research-status",
  "research-cancel", "research-results",
  // Hypothesis operations
  "hypothesis-list", "hypothesis-create", "hypothesis-status", "hypothesis-evidence",
  "hypothesis-test", "hypothesis-confirm", "hypothesis-reject", "hypothesis-refine",
  // Aliases used by hypothesis-lab frontend
  "hypotheses", "hypo-status", "hypo-evidence", "hypo-test",
  "hypo-confirm", "hypo-reject", "hypo-refine",
  // CRI (Concord Research Institutes) operations
  "cri-list", "cri-create", "cri-status", "cri-summit", "cri-add-member", "cri-program",
  // Council operations (read-only — no override/promote)
  "council-voices", "council-decisions",
]);

async function loadModule(path) {
  try {
    return await import(path);
  } catch (err) {
    logger.debug("user-dispatch", `module load failed: ${path}`, { error: err?.message });
    return null;
  }
}

export function createUserDispatchRouter({ STATE } = {}) {
  const router = Router();

  function getSTATE() {
    if (STATE) return STATE;
    if (globalThis._concordSTATE) return globalThis._concordSTATE;
    if (globalThis.STATE) return globalThis.STATE;
    return null;
  }

  router.post("/run", asyncHandler(async (req, res) => {
    const { action, target, data } = req.body || {};

    if (!action) return res.status(400).json({ ok: false, error: "action required" });
    if (!ALLOWED_ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: `unknown action: ${action}` });
    }

    let result;

    // ── Agent operations ──────────────────────────────────────────────────────

    if (action === "agent-list") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      result = { ok: true, agents: mod.listAgents() };
    }

    else if (action === "agent-create") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      const type = target || data?.type;
      if (!type) return res.status(400).json({ ok: false, error: "type required" });
      result = mod.createAgent(type, data?.config || {});
    }

    else if (action === "agent-status") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target (agent id) required" });
      const agent = mod.getAgent(target);
      if (!agent) return res.json({ ok: false, error: `Agent ${target} not found` });
      result = { ok: true, agent };
    }

    else if (action === "agent-pause") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.pauseAgent(target);
    }

    else if (action === "agent-resume") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.resumeAgent(target);
    }

    else if (action === "agent-destroy") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.destroyAgent(target);
    }

    else if (action === "agent-findings") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      if (target) {
        result = { ok: true, findings: mod.getAgentFindings(target, Number(data?.limit) || 50) };
      } else {
        result = { ok: true, findings: mod.getAllFindings(data?.type, Number(data?.limit) || 50) };
      }
    }

    else if (action === "agents-freeze") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      result = mod.freezeAllAgents();
    }

    else if (action === "agents-thaw") {
      const mod = await loadModule("../emergent/agent-system.js");
      if (!mod) return res.json({ ok: false, error: "agent-system not available" });
      result = mod.thawAllAgents();
    }

    // ── Research operations ───────────────────────────────────────────────────

    else if (action === "research") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      const topic = target || data?.topic;
      if (!topic) return res.status(400).json({ ok: false, error: "topic required" });
      result = mod.submitResearchJob(topic, { depth: "normal", ...data?.config });
    }

    else if (action === "research-deep") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      const topic = target || data?.topic;
      if (!topic) return res.status(400).json({ ok: false, error: "topic required" });
      result = mod.submitResearchJob(topic, { depth: "deep", ...data?.config });
    }

    else if (action === "research-queue") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      result = { ok: true, jobs: mod.listResearchJobs(data?.status) };
    }

    else if (action === "research-status") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      const job = mod.getResearchJob(target);
      if (!job) return res.json({ ok: false, error: `Job ${target} not found` });
      result = { ok: true, job };
    }

    else if (action === "research-cancel") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.cancelResearchJob(target);
    }

    else if (action === "research-results") {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = { ok: true, results: mod.getResearchResults(target) };
    }

    // ── Hypothesis operations ─────────────────────────────────────────────────

    else if (action === "hypothesis-create" || action === "hypothesis") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      const statement = target || data?.statement;
      if (!statement) return res.status(400).json({ ok: false, error: "statement required" });
      result = mod.proposeHypothesis(statement, data?.domain, data?.priority);
    }

    else if (action === "hypothesis-list" || action === "hypotheses") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      result = { ok: true, hypotheses: mod.listHypotheses(target || data?.status) };
    }

    else if (action === "hypothesis-status" || action === "hypo-status") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target (hypothesis id) required" });
      const hypo = mod.getHypothesis(target);
      if (!hypo) return res.json({ ok: false, error: `Hypothesis ${target} not found` });
      result = { ok: true, hypothesis: hypo };
    }

    else if (action === "hypothesis-evidence" || action === "hypo-evidence") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      const side = data?.side || "for";
      result = mod.addEvidence(
        target, side,
        data?.dtuId || `dtu_${Date.now()}`,
        Number(data?.weight) || 0.5,
        data?.summary || "Evidence"
      );
    }

    else if (action === "hypothesis-test" || action === "hypo-test") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      if (data?.testId && data?.result) {
        result = mod.updateTestResult(target, data.testId, data.result);
      } else if (data?.description) {
        result = mod.addTest(target, data.description);
      } else {
        return res.status(400).json({ ok: false, error: "data.testId+result or data.description required" });
      }
    }

    else if (action === "hypothesis-confirm" || action === "hypo-confirm") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.confirmHypothesis(target);
    }

    else if (action === "hypothesis-reject" || action === "hypo-reject") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.rejectHypothesis(target, data?.reason || "Rejected");
    }

    else if (action === "hypothesis-refine" || action === "hypo-refine") {
      const mod = await loadModule("../emergent/hypothesis-engine.js");
      if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      if (!data?.statement) return res.status(400).json({ ok: false, error: "data.statement required" });
      result = mod.refineHypothesis(target, data.statement);
    }

    // ── CRI operations ────────────────────────────────────────────────────────

    else if (action === "cri-list") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      result = { ok: true, cris: mod.listCRIs() };
    }

    else if (action === "cri-create") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      const name = target || data?.name;
      if (!name) return res.status(400).json({ ok: false, error: "name required" });
      result = mod.createCRI(name, data?.domain || "general");
    }

    else if (action === "cri-status") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target required" });
      result = mod.getCRIStatus(target);
    }

    else if (action === "cri-summit") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      if (!target) return res.status(400).json({ ok: false, error: "target (criId) required" });
      result = mod.scheduleSummit(target, data?.title || "Summit", data?.participants || [], data?.agenda || []);
    }

    else if (action === "cri-add-member") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      if (!target || !data?.entityId) return res.status(400).json({ ok: false, error: "target and data.entityId required" });
      result = mod.addMember(target, data.entityId, data?.role || "contributor");
    }

    else if (action === "cri-program") {
      const mod = await loadModule("../emergent/cri-system.js");
      if (!mod) return res.json({ ok: false, error: "cri-system not available" });
      if (!target || !data?.title) return res.status(400).json({ ok: false, error: "target and data.title required" });
      result = mod.createProgram(target, data.title, data?.lead || "user");
    }

    // ── Council operations (read-only) ────────────────────────────────────────

    else if (action === "council-voices") {
      const S = getSTATE();
      const { runCouncilVoices, getAllVoices } = await import("../emergent/council-voices.js").catch(() => ({}));
      if (!runCouncilVoices && !getAllVoices) return res.json({ ok: false, error: "council-voices not available" });
      if (target) {
        const dtu = S?.dtus?.get(target);
        if (!dtu) return res.json({ ok: false, error: `DTU ${target} not found` });
        const qualiaState = globalThis.qualiaEngine?.getQualiaState("council");
        result = { ok: true, ...runCouncilVoices(dtu, qualiaState) };
      } else {
        result = { ok: true, voices: getAllVoices() };
      }
    }

    else if (action === "council-decisions") {
      const S = getSTATE();
      const decisions = [];
      if (S?.dtus) {
        for (const dtu of S.dtus.values()) {
          if (dtu.tags?.includes("council-evaluated") || dtu.machine?.councilVotes) {
            decisions.push(dtu);
          }
        }
      }
      decisions.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      result = { ok: true, decisions: decisions.slice(0, Number(data?.limit) || 50), count: decisions.length };
    }

    return res.json(result ?? { ok: true });
  }));

  return router;
}
