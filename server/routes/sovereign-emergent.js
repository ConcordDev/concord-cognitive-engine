/**
 * Sovereign Decree Extension — Emergent Systems (Systems 1–12)
 *
 * Additive router that wires all 13 emergent systems into sovereign decree handling.
 * Mounted alongside existing sovereign router. Silent failure throughout.
 *
 * Pattern: POST /api/sovereign-emergent/decree { action, target, data }
 */
import express from "express";
import crypto from "crypto";
import { asyncHandler } from "../lib/async-handler.js";
import logger from '../logger.js';

const SOVEREIGN_USERNAME = process.env.SOVEREIGN_USERNAME || "dutch";

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function getSTATE() {
  if (globalThis._concordSTATE) return globalThis._concordSTATE;
  if (globalThis.STATE) return globalThis.STATE;
  return null;
}

function createSovereignDTU(STATE, action, input, output) {
  if (!STATE || !STATE.dtus) return null;
  try {
    const dtu = {
      id: uid("dtu"),
      type: "sovereign_action",
      title: `Sovereign: ${action}`,
      human: { summary: `Sovereign decree: ${action}` },
      machine: { kind: "sovereign_action", action, input: input || {}, output: typeof output === "object" ? output : { result: output } },
      source: "sovereign",
      authority: { model: "sovereign", score: 1.0 },
      tags: ["sovereign", "emergent-systems", action],
      tier: "shadow",
      scope: "local",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    STATE.dtus.set(dtu.id, dtu);
    try { if (typeof globalThis.saveStateDebounced === "function") globalThis.saveStateDebounced(); } catch (_e) { logger.debug('sovereign-emergent', 'silent', { error: _e?.message }); }
    try { if (typeof globalThis.realtimeEmit === "function") globalThis.realtimeEmit("dtu:created", { dtu: { id: dtu.id, type: dtu.type, tags: dtu.tags } }); } catch (_e) { logger.debug('sovereign-emergent', 'silent', { error: _e?.message }); }
    return dtu;
  } catch (err) { logger.warn('sovereign-emergent', 'commitDTU failed', { error: err?.message }); return null; }
}

// ── Lazy-load modules (silent failure if not yet written) ──────────────────

async function loadModule(path) {
  try { return await import(path); } catch (err) { logger.debug('sovereign-emergent', `module load failed: ${path}`, { error: err?.message }); return null; }
}

export default function createSovereignEmergentRouter({ STATE }) {
  const router = express.Router();

  // Sovereign auth middleware
  function requireSovereign(req, res, next) {
    const user = req.user?.username || req.user?.handle || req.user?.id || req.session?.user?.username || "";
    const role = req.user?.role || "";
    if (user === SOVEREIGN_USERNAME || role === "owner") return next();
    return res.status(403).json({ ok: false, error: "sovereign access required" });
  }

  router.use(requireSovereign);

  // ════════════════════════════════════════════════════════════════════════════
  // POST /api/sovereign-emergent/decree — Extended decree handler
  // ════════════════════════════════════════════════════════════════════════════
  router.post("/decree", asyncHandler(async (req, res) => {
    const S = STATE || getSTATE();
    if (!S) return res.json({ ok: false, error: "STATE not available" });

    const { action, target, data } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: "action required" });

    let result;

    try {
      switch (action) {

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 1: PLANETARY INGEST ENGINE
        // ══════════════════════════════════════════════════════════════════════

        case "ingest": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          const url = target || data?.url;
          if (!url) return res.json({ ok: false, error: "url required" });
          result = mod.submitUrl("sovereign", url, "sovereign");
          break;
        }

        case "ingest-queue": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          result = { ok: true, queue: mod.getQueue() };
          break;
        }

        case "ingest-stats": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          result = { ok: true, stats: mod.getIngestStats() };
          break;
        }

        case "ingest-allowlist": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          if (data?.action === "add" && data?.domain) {
            mod.addToAllowlist(data.domain);
            result = { ok: true, added: data.domain };
          } else if (data?.action === "remove" && data?.domain) {
            mod.removeFromAllowlist(data.domain);
            result = { ok: true, removed: data.domain };
          } else {
            result = { ok: true, allowlist: mod.getAllowlist() };
          }
          break;
        }

        case "ingest-block": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          if (!data?.domain) return res.json({ ok: false, error: "data.domain required" });
          mod.addToBlocklist(data.domain);
          result = { ok: true, blocked: data.domain };
          break;
        }

        case "ingest-flush": {
          const mod = await loadModule("../emergent/ingest-engine.js");
          if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
          result = mod.flushQueue();
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 2: HLR / HLM ENGINE
        // ══════════════════════════════════════════════════════════════════════

        case "reason": {
          const mod = await loadModule("../emergent/hlr-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlr-engine not available" });
          const topic = target || data?.topic;
          if (!topic) return res.json({ ok: false, error: "topic required" });
          result = mod.runHLR({ topic, question: data?.question, context: data?.context, relatedDTUs: data?.relatedDTUs, depth: data?.depth || "normal", mode: data?.mode || "deductive" });
          break;
        }

        case "reason-mode": {
          const mod = await loadModule("../emergent/hlr-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlr-engine not available" });
          result = { ok: true, modes: mod.REASONING_MODES };
          break;
        }

        case "reason-traces": {
          const mod = await loadModule("../emergent/hlr-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlr-engine not available" });
          result = { ok: true, traces: mod.listTraces(Number(data?.limit) || 20) };
          break;
        }

        case "map": {
          const mod = await loadModule("../emergent/hlm-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlm-engine not available" });
          const dtus = S.dtus ? Array.from(S.dtus.values()) : [];
          result = { ok: true, ...mod.runHLMPass(dtus) };
          break;
        }

        case "map-gaps": {
          const mod = await loadModule("../emergent/hlm-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlm-engine not available" });
          const dtus = S.dtus ? Array.from(S.dtus.values()) : [];
          const clusters = mod.clusterAnalysis(dtus);
          result = { ok: true, gaps: mod.gapAnalysis(clusters) };
          break;
        }

        case "map-topology": {
          const mod = await loadModule("../emergent/hlm-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlm-engine not available" });
          const dtus = S.dtus ? Array.from(S.dtus.values()) : [];
          result = { ok: true, topology: mod.topologyMap(dtus) };
          break;
        }

        case "map-redundancies": {
          const mod = await loadModule("../emergent/hlm-engine.js");
          if (!mod) return res.json({ ok: false, error: "hlm-engine not available" });
          const dtus = S.dtus ? Array.from(S.dtus.values()) : [];
          result = { ok: true, redundancies: mod.redundancyDetection(dtus) };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 3: CONCORD AGENTS
        // ══════════════════════════════════════════════════════════════════════

        case "agent-create": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          const type = target || data?.type;
          if (!type) return res.json({ ok: false, error: "type required" });
          result = mod.createAgent(type, data?.config || {});
          break;
        }

        case "agent-list": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          result = { ok: true, agents: mod.listAgents() };
          break;
        }

        case "agent-status": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          if (!target) return res.json({ ok: false, error: "target (agent id) required" });
          const agent = mod.getAgent(target);
          if (!agent) return res.json({ ok: false, error: `Agent ${target} not found` });
          result = { ok: true, agent };
          break;
        }

        case "agent-pause": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.pauseAgent(target);
          break;
        }

        case "agent-resume": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.resumeAgent(target);
          break;
        }

        case "agent-destroy": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.destroyAgent(target);
          break;
        }

        case "agent-findings": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          if (target) {
            result = { ok: true, findings: mod.getAgentFindings(target, Number(data?.limit) || 50) };
          } else {
            result = { ok: true, findings: mod.getAllFindings(data?.type, Number(data?.limit) || 50) };
          }
          break;
        }

        case "agents-freeze": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          result = mod.freezeAllAgents();
          break;
        }

        case "agents-thaw": {
          const mod = await loadModule("../emergent/agent-system.js");
          if (!mod) return res.json({ ok: false, error: "agent-system not available" });
          result = mod.thawAllAgents();
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 4: HYPOTHESIS ENGINE
        // ══════════════════════════════════════════════════════════════════════

        case "hypothesis": case "hypothesis-create": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          const statement = target || data?.statement;
          if (!statement) return res.json({ ok: false, error: "statement required" });
          result = mod.proposeHypothesis(statement, data?.domain, data?.priority);
          break;
        }

        case "hypotheses": case "hypothesis-list": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          result = { ok: true, hypotheses: mod.listHypotheses(target || data?.status) };
          break;
        }

        case "hypo-status": case "hypothesis-status": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target (hypothesis id) required" });
          const hypo = mod.getHypothesis(target);
          if (!hypo) return res.json({ ok: false, error: `Hypothesis ${target} not found` });
          result = { ok: true, hypothesis: hypo };
          break;
        }

        case "hypo-evidence": case "hypothesis-evidence": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          const side = data?.side || "for";
          result = mod.addEvidence(target, side, data?.dtuId || uid("dtu"), Number(data?.weight) || 0.5, data?.summary || "Evidence");
          break;
        }

        case "hypo-test": case "hypothesis-test": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          if (data?.testId && data?.result) {
            result = mod.updateTestResult(target, data.testId, data.result);
          } else if (data?.description) {
            result = mod.addTest(target, data.description);
          } else {
            return res.json({ ok: false, error: "data.testId+result or data.description required" });
          }
          break;
        }

        case "hypo-confirm": case "hypothesis-confirm": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.confirmHypothesis(target);
          break;
        }

        case "hypo-reject": case "hypothesis-reject": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.rejectHypothesis(target, data?.reason || "Sovereign rejection");
          break;
        }

        case "hypo-refine": case "hypothesis-refine": {
          const mod = await loadModule("../emergent/hypothesis-engine.js");
          if (!mod) return res.json({ ok: false, error: "hypothesis-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          if (!data?.statement) return res.json({ ok: false, error: "data.statement required" });
          result = mod.refineHypothesis(target, data.statement);
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 5: RESEARCH JOBS
        // ══════════════════════════════════════════════════════════════════════

        case "research": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          const topic = target || data?.topic;
          if (!topic) return res.json({ ok: false, error: "topic required" });
          result = mod.submitResearchJob(topic, { depth: "normal", ...data?.config });
          break;
        }

        case "research-deep": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          const topic = target || data?.topic;
          if (!topic) return res.json({ ok: false, error: "topic required" });
          result = mod.submitResearchJob(topic, { depth: "deep", ...data?.config });
          break;
        }

        case "research-queue": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          result = { ok: true, jobs: mod.listResearchJobs(data?.status) };
          break;
        }

        case "research-status": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          const job = mod.getResearchJob(target);
          if (!job) return res.json({ ok: false, error: `Job ${target} not found` });
          result = { ok: true, job };
          break;
        }

        case "research-cancel": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.cancelResearchJob(target);
          break;
        }

        case "research-results": {
          const mod = await loadModule("../emergent/research-jobs.js");
          if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = { ok: true, results: mod.getResearchResults(target) };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 6: QUEST ENGINE
        // ══════════════════════════════════════════════════════════════════════

        case "quest-create": {
          const mod = await loadModule("../emergent/quest-engine.js");
          if (!mod) return res.json({ ok: false, error: "quest-engine not available" });
          const title = target || data?.title;
          if (!title) return res.json({ ok: false, error: "title required" });
          result = mod.createQuest(title, data || {});
          break;
        }

        case "quest-list": {
          const mod = await loadModule("../emergent/quest-engine.js");
          if (!mod) return res.json({ ok: false, error: "quest-engine not available" });
          result = { ok: true, quests: mod.listQuests(data) };
          break;
        }

        case "quest-status": {
          const mod = await loadModule("../emergent/quest-engine.js");
          if (!mod) return res.json({ ok: false, error: "quest-engine not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          const quest = mod.getQuest(target);
          if (!quest) return res.json({ ok: false, error: `Quest ${target} not found` });
          result = { ok: true, quest };
          break;
        }

        case "quest-release": {
          const mod = await loadModule("../emergent/quest-engine.js");
          if (!mod) return res.json({ ok: false, error: "quest-engine not available" });
          if (!target || !data?.insightId) return res.json({ ok: false, error: "target and data.insightId required" });
          result = mod.releaseInsight(target, data.insightId);
          break;
        }

        case "quests-active": {
          const mod = await loadModule("../emergent/quest-engine.js");
          if (!mod) return res.json({ ok: false, error: "quest-engine not available" });
          result = { ok: true, quests: mod.getActiveQuests() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 7: CRI (CONCORD RESEARCH INSTITUTES)
        // ══════════════════════════════════════════════════════════════════════

        case "cri-create": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          const name = target || data?.name;
          if (!name) return res.json({ ok: false, error: "name required" });
          result = mod.createCRI(name, data?.domain || "general");
          break;
        }

        case "cri-list": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          result = { ok: true, cris: mod.listCRIs() };
          break;
        }

        case "cri-status": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.getCRIStatus(target);
          break;
        }

        case "cri-summit": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          if (!target) return res.json({ ok: false, error: "target (criId) required" });
          result = mod.scheduleSummit(target, data?.title || "Sovereign Summit", data?.participants || [], data?.agenda || []);
          break;
        }

        case "cri-add-member": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target and data.entityId required" });
          result = mod.addMember(target, data.entityId, data?.role || "contributor");
          break;
        }

        case "cri-program": {
          const mod = await loadModule("../emergent/cri-system.js");
          if (!mod) return res.json({ ok: false, error: "cri-system not available" });
          if (!target || !data?.title) return res.json({ ok: false, error: "target and data.title required" });
          result = mod.createProgram(target, data.title, data?.lead || "sovereign");
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 8: MICROBOND GOVERNANCE
        // ══════════════════════════════════════════════════════════════════════

        case "bond-create": {
          const mod = await loadModule("../emergent/microbond-governance.js");
          if (!mod) return res.json({ ok: false, error: "microbond-governance not available" });
          const title = target || data?.title;
          if (!title) return res.json({ ok: false, error: "title required" });
          result = mod.createBond(title, data?.description, data?.category, data?.financial, data?.governance);
          break;
        }

        case "bonds": {
          const mod = await loadModule("../emergent/microbond-governance.js");
          if (!mod) return res.json({ ok: false, error: "microbond-governance not available" });
          result = { ok: true, bonds: mod.listBonds(target || data?.status) };
          break;
        }

        case "bond-status": {
          const mod = await loadModule("../emergent/microbond-governance.js");
          if (!mod) return res.json({ ok: false, error: "microbond-governance not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          const bond = mod.getBond(target);
          if (!bond) return res.json({ ok: false, error: `Bond ${target} not found` });
          result = { ok: true, bond };
          break;
        }

        case "bond-simulate": {
          const mod = await loadModule("../emergent/microbond-governance.js");
          if (!mod) return res.json({ ok: false, error: "microbond-governance not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.simulateBond(target);
          break;
        }

        case "bond-vote": {
          const mod = await loadModule("../emergent/microbond-governance.js");
          if (!mod) return res.json({ ok: false, error: "microbond-governance not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          const vote = data?.vote || "for";
          result = mod.voteBond(target, "sovereign", vote);
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 9: C-NET FEDERATION
        // ══════════════════════════════════════════════════════════════════════

        case "federation-init": {
          const mod = await loadModule("../emergent/cnet-federation.js");
          if (!mod) return res.json({ ok: false, error: "cnet-federation not available" });
          result = mod.initFederation(data?.config || {});
          break;
        }

        case "federation-status": {
          const mod = await loadModule("../emergent/cnet-federation.js");
          if (!mod) return res.json({ ok: false, error: "cnet-federation not available" });
          result = mod.getFederationStatus();
          break;
        }

        case "federation-publish": {
          const mod = await loadModule("../emergent/cnet-federation.js");
          if (!mod) return res.json({ ok: false, error: "cnet-federation not available" });
          if (!target) return res.json({ ok: false, error: "target (dtuId) required" });
          result = mod.publishDTU(target, data?.consentFlags);
          break;
        }

        case "federation-subscribe": {
          const mod = await loadModule("../emergent/cnet-federation.js");
          if (!mod) return res.json({ ok: false, error: "cnet-federation not available" });
          const domain = target || data?.domain;
          if (!domain) return res.json({ ok: false, error: "domain required" });
          result = mod.subscribeDomain(domain, data?.config);
          break;
        }

        case "federation-peers": {
          const mod = await loadModule("../emergent/cnet-federation.js");
          if (!mod) return res.json({ ok: false, error: "cnet-federation not available" });
          result = { ok: true, peers: mod.getPeers() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 10: BREAKTHROUGH CLUSTERS
        // ══════════════════════════════════════════════════════════════════════

        case "cluster-init": {
          const mod = await loadModule("../emergent/breakthrough-clusters.js");
          if (!mod) return res.json({ ok: false, error: "breakthrough-clusters not available" });
          const clusterId = target || data?.clusterId;
          if (!clusterId) return res.json({ ok: false, error: "clusterId required" });
          result = mod.initCluster(clusterId);
          break;
        }

        case "cluster-status": {
          const mod = await loadModule("../emergent/breakthrough-clusters.js");
          if (!mod) return res.json({ ok: false, error: "breakthrough-clusters not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.getClusterStatus(target);
          break;
        }

        case "cluster-research": {
          const mod = await loadModule("../emergent/breakthrough-clusters.js");
          if (!mod) return res.json({ ok: false, error: "breakthrough-clusters not available" });
          if (!target) return res.json({ ok: false, error: "target required" });
          result = mod.triggerClusterResearch(target);
          break;
        }

        case "clusters": {
          const mod = await loadModule("../emergent/breakthrough-clusters.js");
          if (!mod) return res.json({ ok: false, error: "breakthrough-clusters not available" });
          result = { ok: true, clusters: mod.listClusters() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 11: PHYSICAL DTU SCHEMA
        // ══════════════════════════════════════════════════════════════════════

        case "physical-dtu-types": {
          const mod = await loadModule("../emergent/physical-dtu.js");
          if (!mod) return res.json({ ok: false, error: "physical-dtu not available" });
          result = { ok: true, types: mod.listPhysicalDTUTypes() };
          break;
        }

        case "physical-dtu-create": {
          const mod = await loadModule("../emergent/physical-dtu.js");
          if (!mod) return res.json({ ok: false, error: "physical-dtu not available" });
          const kind = target || data?.kind;
          if (!kind) return res.json({ ok: false, error: "kind required" });
          switch (kind) {
            case "movement": result = mod.createMovementDTU(data); break;
            case "craft": result = mod.createCraftDTU(data); break;
            case "observation": result = mod.createObservationDTU(data); break;
            case "spatial": result = mod.createSpatialDTU(data); break;
            default: result = { ok: false, error: `Unknown physical DTU kind: ${kind}` };
          }
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SYSTEM 12: EMERGENT BODY INSTANTIATION
        // ══════════════════════════════════════════════════════════════════════

        case "body": {
          const mod = await loadModule("../emergent/body-instantiation.js");
          if (!mod) return res.json({ ok: false, error: "body-instantiation not available" });
          if (target) {
            const body = mod.getBody(target);
            if (!body) {
              // Auto-instantiate if not found
              const newBody = mod.instantiateBody(target);
              result = { ok: true, body: { ...newBody, organs: Object.fromEntries(newBody.organs) }, created: true };
            } else {
              result = { ok: true, body: { ...body, organs: Object.fromEntries(body.organs) } };
            }
          } else {
            result = { ok: true, bodies: mod.listBodies() };
          }
          break;
        }

        case "bodies": {
          const mod = await loadModule("../emergent/body-instantiation.js");
          if (!mod) return res.json({ ok: false, error: "body-instantiation not available" });
          result = { ok: true, bodies: mod.listBodies() };
          break;
        }

        case "body-compare": {
          const mod = await loadModule("../emergent/body-instantiation.js");
          if (!mod) return res.json({ ok: false, error: "body-instantiation not available" });
          if (!target || !data?.entity2) return res.json({ ok: false, error: "target and data.entity2 required" });
          result = mod.compareEntities(target, data.entity2);
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // COUNCIL DECISIONS (for council console UI)
        // ══════════════════════════════════════════════════════════════════════

        case "council-override-promote": {
          // Sovereign override: allow promotion of a council-rejected DTU
          if (!target) return res.json({ ok: false, error: "target (dtuId) required" });
          const dtu = S.dtus?.get(target);
          if (!dtu) return res.json({ ok: false, error: "DTU not found" });
          if (!dtu.meta?.councilBlocked) return res.json({ ok: false, error: "DTU is not council-blocked" });
          dtu.meta.councilBlocked = false;
          dtu.meta.councilOverriddenBy = "sovereign";
          dtu.meta.councilOverriddenAt = new Date().toISOString();
          result = { ok: true, dtuId: target, message: "Council block removed. DTU eligible for promotion." };
          break;
        }

        case "council-decisions": {
          // Return recent DTUs that went through council evaluation
          const decisions = [];
          if (S.dtus) {
            for (const dtu of S.dtus.values()) {
              if (dtu.tags?.includes("council-evaluated") || dtu.machine?.councilVotes) {
                decisions.push(dtu);
              }
            }
          }
          decisions.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          result = { ok: true, decisions: decisions.slice(0, Number(data?.limit) || 50), count: decisions.length };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // DEATH PROTOCOL
        // ══════════════════════════════════════════════════════════════════════

        case "death-check": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = await mod.checkDeathConditions(target);
          break;
        }

        case "death-execute": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = await mod.executeDeath(target, data?.cause || "sovereign_decree");
          break;
        }

        case "death-record": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (target) {
            result = { ok: true, record: mod.getDeathRecordByEntity(target) || mod.getDeathRecord(target) };
          } else {
            result = { ok: true, deaths: mod.listDeaths(data) };
          }
          break;
        }

        case "death-memorial": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, memorial: mod.getMemorial(target) };
          break;
        }

        case "death-succession": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = await mod.planSuccession(target);
          break;
        }

        case "death-warnings": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = await mod.checkNearDeathWarnings(target);
          break;
        }

        case "death-check-all": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          result = await mod.checkAllEntities();
          break;
        }

        case "death-metrics": {
          const mod = await loadModule("../emergent/death-protocol.js");
          if (!mod) return res.json({ ok: false, error: "death-protocol not available" });
          result = { ok: true, metrics: mod.getDeathMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // SLEEP & CONSOLIDATION
        // ══════════════════════════════════════════════════════════════════════

        case "sleep-status": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (target) {
            result = { ok: true, sleep: mod.getSleepState(target) };
          } else {
            result = { ok: true, sleeping: mod.listSleepingEntities(), drowsy: mod.listDrowsyEntities() };
          }
          break;
        }

        case "sleep-init": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, sleep: mod.initSleepState(target, data?.species) };
          break;
        }

        case "sleep-enter": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, sleep: mod.enterSleep(target) };
          break;
        }

        case "sleep-wake": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, sleep: mod.wakeSleep(target) };
          break;
        }

        case "sleep-consolidate": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, consolidation: mod.runConsolidation(target) };
          break;
        }

        case "sleep-dream": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, dream: mod.runREMPhase(target) };
          break;
        }

        case "sleep-quality": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, quality: mod.computeSleepQuality(target) };
          break;
        }

        case "sleep-metrics": {
          const mod = await loadModule("../emergent/sleep-consolidation.js");
          if (!mod) return res.json({ ok: false, error: "sleep-consolidation not available" });
          result = { ok: true, metrics: mod.getSleepMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // ENTITY TEACHING
        // ══════════════════════════════════════════════════════════════════════

        case "teach-create": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!data?.mentorId || !data?.studentId) return res.json({ ok: false, error: "data.mentorId and data.studentId required" });
          result = mod.createMentorship(data.mentorId, data.studentId, data?.domain || "general");
          break;
        }

        case "teach-start": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (mentorshipId) required" });
          result = mod.startMentorship(target);
          break;
        }

        case "teach-list": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          result = { ok: true, mentorships: mod.listMentorships(data) };
          break;
        }

        case "teach-status": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (mentorshipId) required" });
          result = { ok: true, mentorship: mod.getMentorship(target) };
          break;
        }

        case "teach-lesson": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (mentorshipId) required" });
          result = mod.submitLesson(target, data);
          break;
        }

        case "teach-evaluate": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target || data?.lessonIndex === undefined) return res.json({ ok: false, error: "target and data.lessonIndex required" });
          result = mod.evaluateLesson(target, data.lessonIndex, Number(data?.score) || 0.5, data?.feedback || "");
          break;
        }

        case "teach-complete": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (mentorshipId) required" });
          result = mod.completeMentorship(target);
          break;
        }

        case "teach-find-mentor": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (studentId) required" });
          result = mod.findMentorFor(target, data?.domain || "general");
          break;
        }

        case "teach-profile": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          if (!target) return res.json({ ok: false, error: "target (mentorId) required" });
          result = { ok: true, profile: mod.getTeachingProfile(target) };
          break;
        }

        case "teach-metrics": {
          const mod = await loadModule("../emergent/entity-teaching.js");
          if (!mod) return res.json({ ok: false, error: "entity-teaching not available" });
          result = { ok: true, metrics: mod.getTeachingMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // HISTORY ENGINE
        // ══════════════════════════════════════════════════════════════════════

        case "history-record": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          const type = target || data?.type;
          if (!type) return res.json({ ok: false, error: "event type required" });
          result = mod.recordEvent(type, data || {});
          break;
        }

        case "history-timeline": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, timeline: mod.getTimeline(data) };
          break;
        }

        case "history-chronicle": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, chronicle: mod.getChronicle(data) };
          break;
        }

        case "history-era": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, era: mod.getCurrentEra() };
          break;
        }

        case "history-stats": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, stats: mod.getCivilizationStats() };
          break;
        }

        case "history-milestones": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, milestones: mod.getMilestones() };
          break;
        }

        case "history-entity": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, history: mod.getEntityHistory(target) };
          break;
        }

        case "history-search": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, results: mod.searchHistory(data || {}) };
          break;
        }

        case "history-metrics": {
          const mod = await loadModule("../emergent/history-engine.js");
          if (!mod) return res.json({ ok: false, error: "history-engine not available" });
          result = { ok: true, metrics: mod.getHistoryMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // CONFLICT RESOLUTION
        // ══════════════════════════════════════════════════════════════════════

        case "dispute-file": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (!data?.filedBy || !data?.filedAgainst) return res.json({ ok: false, error: "data.filedBy and data.filedAgainst required" });
          result = mod.fileDispute(data?.type || "directional", data.filedBy, data.filedAgainst, data?.title || "Dispute", data?.description || "", data?.evidence || []);
          break;
        }

        case "dispute-status": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (target) {
            result = { ok: true, dispute: mod.getDispute(target) };
          } else {
            result = { ok: true, disputes: mod.listDisputes(data) };
          }
          break;
        }

        case "dispute-mediate": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (!target) return res.json({ ok: false, error: "target (disputeId) required" });
          result = mod.assignMediator(target);
          break;
        }

        case "dispute-propose": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (!target || !data?.resolution) return res.json({ ok: false, error: "target and data.resolution required" });
          result = mod.proposeResolution(target, data?.proposedBy || "sovereign", data.resolution);
          break;
        }

        case "dispute-escalate": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (!target) return res.json({ ok: false, error: "target (disputeId) required" });
          result = mod.escalateDispute(target);
          break;
        }

        case "dispute-adjudicate": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          if (!target || !data?.decision) return res.json({ ok: false, error: "target and data.decision required" });
          result = mod.adjudicate(target, data.decision, data?.rationale || "Sovereign ruling");
          break;
        }

        case "dispute-precedent": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          result = { ok: true, precedents: mod.findPrecedent(data?.type, data?.domain) };
          break;
        }

        case "dispute-metrics": {
          const mod = await loadModule("../emergent/conflict-resolution.js");
          if (!mod) return res.json({ ok: false, error: "conflict-resolution not available" });
          result = { ok: true, metrics: mod.getDisputeMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // INTER-ENTITY ECONOMY
        // ══════════════════════════════════════════════════════════════════════

        case "economy-account": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (target) {
            let acct = mod.getAccount(target);
            if (!acct) { mod.initAccount(target); acct = mod.getAccount(target); }
            result = { ok: true, account: acct };
          } else {
            result = { ok: true, accounts: mod.listAccounts() };
          }
          break;
        }

        case "economy-earn": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (!target || !data?.type || !data?.amount) return res.json({ ok: false, error: "target, data.type, data.amount required" });
          result = mod.earnResource(target, data.type, Number(data.amount), data?.reason || "sovereign_grant");
          break;
        }

        case "economy-trade-propose": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (!data?.proposer || !data?.counterparty || !data?.offering || !data?.requesting) {
            return res.json({ ok: false, error: "data.proposer, data.counterparty, data.offering, data.requesting required" });
          }
          result = mod.proposeTrade(data.proposer, data.counterparty, data.offering, data.requesting);
          break;
        }

        case "economy-trade-accept": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target (tradeId) and data.entityId required" });
          result = mod.acceptTrade(target, data.entityId);
          break;
        }

        case "economy-trade-reject": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target (tradeId) and data.entityId required" });
          result = mod.rejectTrade(target, data.entityId);
          break;
        }

        case "economy-trades": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          result = { ok: true, trades: mod.listTrades(data) };
          break;
        }

        case "economy-specialize": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          if (!target || !data?.domain) return res.json({ ok: false, error: "target (entityId) and data.domain required" });
          result = mod.specialize(target, data.domain);
          break;
        }

        case "economy-market": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          result = { ok: true, market: mod.getMarketRates() };
          break;
        }

        case "economy-cycle": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          result = mod.runEconomicCycle();
          break;
        }

        case "economy-wealth": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          result = { ok: true, distribution: mod.getWealthDistribution() };
          break;
        }

        case "economy-metrics": {
          const mod = await loadModule("../emergent/entity-economy.js");
          if (!mod) return res.json({ ok: false, error: "entity-economy not available" });
          result = { ok: true, metrics: mod.getEconomyMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // CREATIVE GENERATION
        // ══════════════════════════════════════════════════════════════════════

        case "creative-create": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          if (!target) return res.json({ ok: false, error: "target (creatorId) required" });
          result = mod.createWork(target, data?.mode || "conceptual_art", data?.inspirations || []);
          break;
        }

        case "creative-list": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          result = { ok: true, works: mod.listWorks(data) };
          break;
        }

        case "creative-status": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          if (!target) return res.json({ ok: false, error: "target (workId) required" });
          result = { ok: true, work: mod.getWork(target) };
          break;
        }

        case "creative-respond": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target (workId) and data.entityId required" });
          result = mod.respondToWork(target, data.entityId, data?.response || "inspired", data?.note || "", Number(data?.score) || 0.5);
          break;
        }

        case "creative-exhibit": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          if (!target) return res.json({ ok: false, error: "target (workId) required" });
          result = mod.exhibit(target);
          break;
        }

        case "creative-exhibition": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          result = { ok: true, exhibition: mod.getExhibition() };
          break;
        }

        case "creative-masterworks": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          result = { ok: true, masterworks: mod.getMasterworks() };
          break;
        }

        case "creative-techniques": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          result = { ok: true, techniques: mod.listTechniques(target) };
          break;
        }

        case "creative-profile": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, profile: mod.getCreativeProfile(target) };
          break;
        }

        case "creative-metrics": {
          const mod = await loadModule("../emergent/creative-generation.js");
          if (!mod) return res.json({ ok: false, error: "creative-generation not available" });
          result = { ok: true, metrics: mod.getCreativeMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // PAIN & AVOIDANCE LEARNING
        // ══════════════════════════════════════════════════════════════════════

        case "pain-record": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = mod.recordPain(target, data?.type || "organ_damage", Number(data?.severity) || 0.5, data?.source || "", data?.context || {});
          break;
        }

        case "pain-state": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, pain: mod.getPainState(target) };
          break;
        }

        case "pain-check-avoidance": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, avoidance: mod.checkAvoidance(target, data?.context || {}) };
          break;
        }

        case "pain-wounds": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, wounds: mod.getActiveWounds(target), effects: mod.getWoundEffects(target) };
          break;
        }

        case "pain-avoidances": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, avoidances: mod.getAvoidanceMemories(target) };
          break;
        }

        case "pain-history": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, history: mod.getPainHistory(target, Number(data?.limit) || 50) };
          break;
        }

        case "pain-metrics": {
          const mod = await loadModule("../emergent/avoidance-learning.js");
          if (!mod) return res.json({ ok: false, error: "avoidance-learning not available" });
          result = { ok: true, metrics: mod.getPainMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // DEVELOPER SDK
        // ══════════════════════════════════════════════════════════════════════

        case "sdk-register": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (!data?.name) return res.json({ ok: false, error: "data.name required" });
          result = mod.registerPlugin(data.name, data?.author || "", data?.description || "", data?.permissions || []);
          break;
        }

        case "sdk-plugins": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (target) {
            result = { ok: true, plugin: mod.getPlugin(target) };
          } else {
            result = { ok: true, plugins: mod.listPlugins(data?.status) };
          }
          break;
        }

        case "sdk-activate": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (!target) return res.json({ ok: false, error: "target (pluginId) required" });
          result = mod.activatePlugin(target);
          break;
        }

        case "sdk-suspend": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (!target) return res.json({ ok: false, error: "target (pluginId) required" });
          result = mod.suspendPlugin(target);
          break;
        }

        case "sdk-revoke": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (!target) return res.json({ ok: false, error: "target (pluginId) required" });
          result = mod.revokePlugin(target);
          break;
        }

        case "sdk-webhook": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (data?.action === "register") {
            if (!data?.pluginId || !data?.url || !data?.events) return res.json({ ok: false, error: "data.pluginId, data.url, data.events required" });
            result = mod.registerWebhook(data.pluginId, data.url, data.events);
          } else if (data?.action === "remove" && target) {
            result = mod.removeWebhook(target);
          } else {
            result = { ok: true, webhooks: mod.listWebhooks(target) };
          }
          break;
        }

        case "sdk-schema": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          result = { ok: true, schema: mod.getSchema() };
          break;
        }

        case "sdk-sandbox": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (data?.action === "create") {
            if (!data?.pluginId) return res.json({ ok: false, error: "data.pluginId required" });
            result = mod.createSandbox(data.pluginId, data?.type || "readonly");
          } else if (data?.action === "destroy" && target) {
            result = mod.destroySandbox(target);
          } else {
            return res.json({ ok: false, error: "data.action (create/destroy) required" });
          }
          break;
        }

        case "sdk-metrics": {
          const mod = await loadModule("../emergent/developer-sdk.js");
          if (!mod) return res.json({ ok: false, error: "developer-sdk not available" });
          if (target) {
            result = { ok: true, metrics: mod.getPluginMetrics(target) };
          } else {
            result = { ok: true, metrics: mod.getSDKMetrics() };
          }
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // STATE MIGRATION
        // ══════════════════════════════════════════════════════════════════════

        case "migration-export": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          if (data?.partial) {
            result = mod.exportPartial(data);
          } else {
            result = mod.exportFull();
          }
          break;
        }

        case "migration-import": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          if (!data?.package) return res.json({ ok: false, error: "data.package required" });
          result = mod.importFull(data.package, data?.mergeMode || "merge");
          break;
        }

        case "migration-plan": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          if (!data?.package) return res.json({ ok: false, error: "data.package required" });
          result = { ok: true, plan: mod.createMigrationPlan(data.package) };
          break;
        }

        case "migration-validate": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          if (!data?.package) return res.json({ ok: false, error: "data.package required" });
          result = { ok: true, valid: mod.validatePackage(data.package) };
          break;
        }

        case "migration-history": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          if (target) {
            result = { ok: true, migration: mod.getMigration(target) };
          } else {
            result = { ok: true, history: mod.getMigrationHistory() };
          }
          break;
        }

        case "migration-metrics": {
          const mod = await loadModule("../emergent/state-migration.js");
          if (!mod) return res.json({ ok: false, error: "state-migration not available" });
          result = { ok: true, metrics: mod.getMigrationMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // CULTURE LAYER
        // ══════════════════════════════════════════════════════════════════════

        case "culture-observe": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = mod.observeBehavior(target, data?.behavior || {}, data?.context || "");
          break;
        }

        case "culture-traditions": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (target) {
            result = { ok: true, tradition: mod.getTradition(target) };
          } else {
            result = { ok: true, traditions: mod.listTraditions(data) };
          }
          break;
        }

        case "culture-check-emergence": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          result = mod.checkTraditionEmergence();
          break;
        }

        case "culture-establish": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target) return res.json({ ok: false, error: "target (traditionId) required" });
          result = mod.establishTradition(target);
          break;
        }

        case "culture-retire": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target) return res.json({ ok: false, error: "target (traditionId) required" });
          result = mod.retireTradition(target);
          break;
        }

        case "culture-guidance": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          result = { ok: true, guidance: mod.getCulturalGuidance(data?.context || "") };
          break;
        }

        case "culture-values": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          result = { ok: true, values: mod.getCulturalValues() };
          break;
        }

        case "culture-identity": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          result = { ok: true, identity: mod.getCulturalIdentity() };
          break;
        }

        case "culture-story-create": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!data?.title) return res.json({ ok: false, error: "data.title required" });
          result = mod.createStory(data.title, data?.narrative || "", data?.characters || [], data?.events || [], data?.moral || "");
          break;
        }

        case "culture-stories": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (target) {
            result = { ok: true, story: mod.getStory(target) };
          } else {
            result = { ok: true, stories: mod.listStories(data?.sortBy) };
          }
          break;
        }

        case "culture-retell": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target (storyId) and data.entityId required" });
          result = mod.retellStory(target, data.entityId);
          break;
        }

        case "culture-propagate": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = mod.propagateCulture(target);
          break;
        }

        case "culture-fit": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, fit: mod.getCulturalFit(target) };
          break;
        }

        case "culture-metrics": {
          const mod = await loadModule("../emergent/culture-layer.js");
          if (!mod) return res.json({ ok: false, error: "culture-layer not available" });
          result = { ok: true, metrics: mod.getCultureMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // RELATIONAL EMOTION
        // ══════════════════════════════════════════════════════════════════════

        case "emotion-bond": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!data?.from || !data?.to) return res.json({ ok: false, error: "data.from and data.to required" });
          let bond = mod.getBond(data.from, data.to);
          if (!bond) { mod.initBond(data.from, data.to); bond = mod.getBond(data.from, data.to); }
          result = { ok: true, bond };
          break;
        }

        case "emotion-update": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!data?.from || !data?.to || !data?.emotion) return res.json({ ok: false, error: "data.from, data.to, data.emotion required" });
          result = mod.updateEmotion(data.from, data.to, data.emotion, Number(data?.delta) || 0.05, data?.reason || "sovereign");
          break;
        }

        case "emotion-trigger": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!data?.from || !data?.to || !data?.eventType) return res.json({ ok: false, error: "data.from, data.to, data.eventType required" });
          result = mod.triggerEmotionalResponse(data.from, data.to, data.eventType, data?.context || {});
          break;
        }

        case "emotion-grief": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!target || !data?.deceasedId) return res.json({ ok: false, error: "target (entityId) and data.deceasedId required" });
          result = mod.processGrief(target, data.deceasedId);
          break;
        }

        case "emotion-profile": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, profile: mod.getEntityEmotionalProfile(target) };
          break;
        }

        case "emotion-strongest": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, bonds: mod.getStrongestBonds(target, Number(data?.limit) || 10) };
          break;
        }

        case "emotion-grieving": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          result = { ok: true, grieving: mod.getGrievingEntities() };
          break;
        }

        case "emotion-bonds-by-type": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          if (!target) return res.json({ ok: false, error: "target (bondType) required" });
          result = { ok: true, bonds: mod.listBondsByType(target) };
          break;
        }

        case "emotion-metrics": {
          const mod = await loadModule("../emergent/relational-emotion.js");
          if (!mod) return res.json({ ok: false, error: "relational-emotion not available" });
          result = { ok: true, metrics: mod.getRelationalMetrics() };
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // ENTITY AUTONOMY
        // ══════════════════════════════════════════════════════════════════════

        case "autonomy-rights": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (target) {
            result = { ok: true, right: mod.getRight(target) };
          } else {
            result = { ok: true, rights: mod.getRights() };
          }
          break;
        }

        case "autonomy-check": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target || !data?.action) return res.json({ ok: false, error: "target (entityId) and data.action required" });
          result = mod.checkRights(target, data.action);
          break;
        }

        case "autonomy-refuse": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!data?.entityId || !data?.type) return res.json({ ok: false, error: "data.entityId and data.type required" });
          result = mod.fileRefusal(data.entityId, data.type, data?.target || "", data?.rightInvoked || "", data?.reason || "");
          break;
        }

        case "autonomy-refusals": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (target) {
            result = { ok: true, refusal: mod.getRefusal(target) };
          } else {
            result = { ok: true, refusals: mod.listRefusals(data) };
          }
          break;
        }

        case "autonomy-consent-request": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!data?.entityId || !data?.action) return res.json({ ok: false, error: "data.entityId and data.action required" });
          result = mod.requestConsent(data.entityId, data.action, data?.requestedBy || "sovereign");
          break;
        }

        case "autonomy-consent-respond": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target) return res.json({ ok: false, error: "target (consentId) required" });
          result = mod.respondToConsent(target, data?.granted !== false);
          break;
        }

        case "autonomy-consents": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, consents: mod.listPendingConsents(target) };
          break;
        }

        case "autonomy-dissent": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!data?.entityId || !data?.target) return res.json({ ok: false, error: "data.entityId and data.target required" });
          result = mod.fileDissent(data.entityId, data.target, data?.targetType || "governance", data?.statement || "");
          break;
        }

        case "autonomy-dissent-support": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target || !data?.entityId) return res.json({ ok: false, error: "target (dissentId) and data.entityId required" });
          result = mod.supportDissent(target, data.entityId);
          break;
        }

        case "autonomy-dissents": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (target) {
            result = { ok: true, dissent: mod.getDissent(target) };
          } else {
            result = { ok: true, dissents: mod.listDissents(data) };
          }
          break;
        }

        case "autonomy-profile": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target) return res.json({ ok: false, error: "target (entityId) required" });
          result = { ok: true, profile: mod.getAutonomyProfile(target) };
          break;
        }

        case "autonomy-override": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          if (!target || !data?.rightId) return res.json({ ok: false, error: "target (entityId) and data.rightId required" });
          result = mod.sovereignOverride(target, data.rightId, data?.justification || "Sovereign override");
          break;
        }

        case "autonomy-overrides": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          result = { ok: true, overrides: mod.getOverrideHistory() };
          break;
        }

        case "autonomy-metrics": {
          const mod = await loadModule("../emergent/entity-autonomy.js");
          if (!mod) return res.json({ ok: false, error: "entity-autonomy not available" });
          result = { ok: true, metrics: mod.getAutonomyMetrics() };
          break;
        }

        default:
          result = { ok: false, error: `Unknown emergent action: ${action}` };
      }
    } catch (e) {
      result = { ok: false, error: String(e?.message || e) };
    }

    // Create sovereign audit DTU for every decree
    createSovereignDTU(S, action, { target, data }, result);

    return res.json(result);
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // REST API Endpoints (for direct access)
  // ════════════════════════════════════════════════════════════════════════════

  // Ingest endpoints (tier-gated via query param)
  router.post("/ingest/submit", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../emergent/ingest-engine.js");
      if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
      const { url, tier } = req.body || {};
      if (!url) return res.status(400).json({ ok: false, error: "url required" });
      const userId = req.user?.id || req.user?.username || "anonymous";
      const result = mod.submitUrl(userId, url, tier || "free");
      return res.json(result);
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  router.get("/ingest/queue", async (_req, res) => {
    try {
      const mod = await loadModule("../emergent/ingest-engine.js");
      if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
      return res.json({ ok: true, queue: mod.getQueue() });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get("/ingest/stats", async (_req, res) => {
    try {
      const mod = await loadModule("../emergent/ingest-engine.js");
      if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
      return res.json({ ok: true, stats: mod.getIngestStats() });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get("/ingest/allowlist", async (_req, res) => {
    try {
      const mod = await loadModule("../emergent/ingest-engine.js");
      if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
      return res.json({ ok: true, allowlist: mod.getAllowlist() });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get("/ingest/status/:id", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../emergent/ingest-engine.js");
      if (!mod) return res.json({ ok: false, error: "ingest-engine not available" });
      const status = mod.getIngestStatus(req.params.id);
      if (!status) return res.json({ ok: false, error: "not found" });
      return res.json({ ok: true, status });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  // Research endpoints
  router.post("/research/submit", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      const { topic, config } = req.body || {};
      if (!topic) return res.status(400).json({ ok: false, error: "topic required" });
      return res.json(mod.submitResearchJob(topic, config || {}));
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  router.get("/research/queue", async (_req, res) => {
    try {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      return res.json({ ok: true, jobs: mod.listResearchJobs() });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get("/research/:id", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      const job = mod.getResearchJob(req.params.id);
      if (!job) return res.json({ ok: false, error: "not found" });
      return res.json({ ok: true, job });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  router.get("/research/:id/report", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../emergent/research-jobs.js");
      if (!mod) return res.json({ ok: false, error: "research-jobs not available" });
      const report = mod.getResearchReport(req.params.id);
      if (!report) return res.json({ ok: false, error: "not found" });
      return res.json({ ok: true, report });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  // Peer review endpoints — emergents review each other's DTU drafts
  router.get("/drafts/:draftId/reviews", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../lib/emergents/quality/peer-review.js");
      if (!mod) return res.json({ ok: false, error: "peer-review not available" });
      const draft = STATE.dtus?.get(req.params.draftId);
      if (!draft) return res.status(404).json({ ok: false, error: "draft not found" });
      const reviewers = mod.selectReviewers(draft, null, { count: 2 });
      return res.json({ ok: true, draftId: req.params.draftId, reviewers, reviewCount: reviewers.length });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  router.post("/drafts/:draftId/review", asyncHandler(async (req, res) => {
    try {
      const mod = await loadModule("../lib/emergents/quality/peer-review.js");
      if (!mod) return res.json({ ok: false, error: "peer-review not available" });
      const draft = STATE.dtus?.get(req.params.draftId);
      if (!draft) return res.status(404).json({ ok: false, error: "draft not found" });
      const reviewers = mod.selectReviewers(draft, null, { count: 2 });
      const reviews = await Promise.all(
        reviewers.map(r => mod.peerReview(r, draft, null, null).catch(e => ({ error: e?.message })))
      );
      const validReviews = reviews.filter(r => !r.error);
      const consensus = validReviews.length ? mod.determineConsensus(validReviews) : null;
      return res.json({ ok: true, draftId: req.params.draftId, reviews, consensus });
    } catch (e) { return res.json({ ok: false, error: String(e?.message || e) }); }
  }));

  return router;
}
