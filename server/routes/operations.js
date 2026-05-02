/**
 * Operations routes — extracted from server.js
 * Covers: verify, experiments, synth, jobs, agents, ingest, market, global,
 *         proposals, organs, growth, lattice, harness, style, reseed,
 *         abstraction, queues, auth/keys, orgs, research
 * Registered directly on app (mixed prefixes)
 */
import fs from "fs";
import { asyncHandler } from "../lib/async-handler.js";
import { validateBody, ingestUrlSchema, ingestTextSchema, ingestSchema, ingestSubmitSchema, researchRunSchema, harnessRunSchema, apiKeyCreateSchema } from "../lib/validators/mutation-schemas.js";

export default function registerOperationRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  _withAck,
  ensureOrganRegistry,
  ensureQueues,
  dtusArray,
  userVisibleDTUs,
  uid,
  sha256Hex,
  nowISO,
  saveStateDebounced,
  requireRole,
  PIPE,
  TEMPORAL_FRAMES,
  pipeListProposals,
  computeAbstractionSnapshot,
  maybeRunLocalUpgrade,
  runAutoPromotion,
  tryLoadSeedDTUs,
  toOptionADTU,
  SEED_INFO,
  _kernelTick,
  _uiJson
}) {

  // Organs + Growth endpoints
  app.get("/api/organs", (req, res) => {
    ensureOrganRegistry();
    ensureQueues();
    const organs = Array.from(STATE.organs.values()).map(o => ({
      organId: o.organId,
      resolution: o.resolution,
      maturity: o.maturity,
      wear: o.wear,
      deps: o.deps,
      desc: o.desc
    }));
    res.json({ ok:true, organs });
  });

  app.get("/api/organs/:id", (req, res) => {
    ensureOrganRegistry();
    ensureQueues();
    const id = String(req.params.id || "");
    const o = STATE.organs.get(id);
    if (!o) return res.status(404).json({ ok:false, error: "Organ not found" });
    res.json({ ok:true, organ: o });
  });

  app.get("/api/growth", (req, res) => {
    ensureOrganRegistry();
    ensureQueues();
    res.json({ ok:true, growth: STATE.growth });
  });

  app.get("/api/lattice/beacon", asyncHandler(async (req, res) => {
    try{
      const ctx = makeCtx(req);
      const out = await ctx.macro.run("lattice", "beacon", { threshold: req.query.threshold });
      res.json(out);
    } catch(e){
      res.status(500).json({ ok:false, error:String(e?.message||e), meta: e?.meta || null });
    }
  }));

  app.post("/api/harness/run", validateBody(harnessRunSchema), asyncHandler(async (req, res) => {
    try{
      const ctx = makeCtx(req);
      const out = await ctx.macro.run("harness", "run", req.body || {});
      res.json(out);
    } catch(e){
      res.status(500).json({ ok:false, error:String(e?.message||e), meta: e?.meta || null });
    }
  }));

  // === v3 identity/account + global + marketplace + ingest endpoints (explicit HTTP surface) ===
  // These wrap existing macro domains so frontend can wire cleanly without calling /api/macros/run directly.

  app.post("/api/auth/keys", validateBody(apiKeyCreateSchema), asyncHandler(async (req,res) => {
    try {
      const input = req.body || {};
      return res.json(await runMacro("auth","createApiKey", input, makeCtx(req)));
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  }));

  app.post("/api/orgs", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("org","create", req.body||{}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  // --- Research (engine dispatcher) ---
  app.post("/api/research/run", validateBody(researchRunSchema), asyncHandler(async (req,res) => {
    try {
      const engine = String(req.body?.engine || "math.exec");
      const input = req.body?.input ?? req.body ?? {};
      return res.json(await runMacro("research", engine, input, makeCtx(req)));
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  }));

  // --- Ingest (URL/text) ---
  app.post("/api/ingest/url", validateBody(ingestUrlSchema), asyncHandler(async (req,res) => {
    try {
      const url = String(req.body?.url||"").trim();
      if (!url) return res.status(400).json({ ok:false, error:"url required" });
      const out = await runMacro("crawl","fetch", { url }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  }));

  app.post("/api/ingest/text", validateBody(ingestTextSchema), (req,res) => {
    try {
      const text = String(req.body?.text||"").trim();
      const title = String(req.body?.title||"").trim();
      if (!text) return res.status(400).json({ ok:false, error:"text required" });
      // Store as a source-like object in STATE.sources so it can be referenced later by id/hash.
      const id = uid("src");
      const contentHash = sha256Hex(text);
      const src = { id, url: "", fetchedAt: nowISO(), contentHash, title: title || `Text source ${id}`, excerpt: text.slice(0,800), text, meta: { kind:"text", createdAt: nowISO() } };
      STATE.sources.set(id, src);
      return res.json({ ok:true, source: src });
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // Unified ingest endpoint (handles both text and URL based on input)
  app.post("/api/ingest", validateBody(ingestSchema), asyncHandler(async (req, res) => {
    try {
      const { text, url, title, tags, makeGlobal, declaredSourceType } = req.body || {};

      // Determine if this is text or URL ingest
      if (url && String(url).trim()) {
        // URL-based ingest
        const out = await runMacro("crawl", "fetch", {
          url: String(url).trim(),
          tags: tags || [],
          makeGlobal: makeGlobal || false,
          declaredSourceType: declaredSourceType || "url"
        }, makeCtx(req));
        return res.json(out);
      } else if (text && String(text).trim()) {
        // Text-based ingest
        const id = uid("src");
        const contentHash = sha256Hex(String(text).trim());
        const src = {
          id,
          url: "",
          fetchedAt: nowISO(),
          contentHash,
          title: title || `Text source ${id}`,
          excerpt: String(text).slice(0, 800),
          text: String(text).trim(),
          tags: tags || [],
          isGlobal: makeGlobal || false,
          declaredSourceType: declaredSourceType || "text",
          meta: { kind: "text", createdAt: nowISO() }
        };
        STATE.sources.set(id, src);
        saveStateDebounced();
        return res.json({ ok: true, source: src });
      } else {
        return res.status(400).json({ ok: false, error: "Either 'text' or 'url' is required" });
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // Queue-based ingest (adds to processing queue)
  app.post("/api/ingest/queue", (req, res) => {
    try {
      const { text, url, title, tags, makeGlobal, declaredSourceType } = req.body || {};

      const queueItem = {
        id: uid("ingest"),
        type: url ? "url" : "text",
        payload: { text, url, title, tags, makeGlobal, declaredSourceType },
        status: "queued",
        createdAt: nowISO(),
        createdBy: req.user?.id || "anon"
      };

      ensureQueues();
      STATE.queues.ingest = STATE.queues.ingest || [];
      STATE.queues.ingest.push(queueItem);
      saveStateDebounced();

      return res.json({ ok: true, queued: true, item: queueItem });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── Planetary Ingest Engine (tier-gated REST endpoints) ───────────────────
  // These wire to ingest-engine.js for the full pipeline:
  // URL → tier check → domain validation → fetch → extract → dedup → HLR → council gate → DTU

  app.post("/api/ingest/submit", validateBody(ingestSubmitSchema), asyncHandler(async (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      if (!url) return res.status(400).json({ ok: false, error: "url required" });

      // eslint-disable-next-line no-restricted-syntax
      // eslint-disable-next-line no-restricted-syntax
      const userId = req.user?.id || req.body?.userId || "anon"; // safe: target-identifier
      const tier = req.body?.tier || "free";

      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.submitUrl) return res.status(501).json({ ok: false, error: "Ingest engine not available" });

      const result = await mod.submitUrl(userId, url, tier);
      if (!result.ok && result.error?.includes("rate limit")) {
        return res.status(429).json(result);
      }
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.get("/api/ingest/status/:id", asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.getIngestStatus) return res.status(501).json({ ok: false, error: "Ingest engine not available" });
      const result = mod.getIngestStatus(req.params.id);
      if (!result) return res.status(404).json({ ok: false, error: "Ingest job not found" });
      return res.json({ ok: true, job: result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.get("/api/ingest/queue", asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.getQueue) return res.json({ ok: true, queue: [], total: 0 });
      const userId = req.user?.id || null;
      const queue = mod.getQueue();
      // Non-sovereign users only see their own items
      const role = req.user?.role || "guest";
      const isSovereign = ["owner", "admin", "founder"].includes(role);
      const items = isSovereign ? queue : (queue || []).filter(j => j.userId === userId);
      return res.json({ ok: true, queue: items, total: items.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.get("/api/ingest/history", asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.getIngestMetrics) return res.json({ ok: true, history: [], metrics: {} });
      const metrics = mod.getIngestMetrics();
      return res.json({ ok: true, metrics });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.get("/api/ingest/stats", asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.getIngestStats) return res.json({ ok: true, stats: {} });
      const stats = mod.getIngestStats();
      return res.json({ ok: true, ...stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.get("/api/ingest/allowlist", asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.getAllowlist) return res.json({ ok: true, allowlist: [] });
      return res.json({ ok: true, allowlist: mod.getAllowlist() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.post("/api/ingest/allowlist", requireRole("owner", "admin", "founder"), asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod) return res.status(501).json({ ok: false, error: "Ingest engine not available" });
      const { action, domain } = req.body || {};
      if (!domain) return res.status(400).json({ ok: false, error: "domain required" });
      if (action === "remove" && mod.removeFromAllowlist) {
        return res.json({ ok: true, ...mod.removeFromAllowlist(domain) });
      }
      if (mod.addToAllowlist) {
        return res.json({ ok: true, ...mod.addToAllowlist(domain) });
      }
      return res.status(501).json({ ok: false, error: "Allowlist management not available" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.post("/api/ingest/flush", requireRole("owner", "admin", "founder"), asyncHandler(async (req, res) => {
    try {
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.flushQueue) return res.status(501).json({ ok: false, error: "Flush not available" });
      const result = mod.flushQueue();
      return res.json({ ok: true, ...(typeof result === "object" ? result : {}) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  app.post("/api/ingest/block", requireRole("owner", "admin", "founder"), asyncHandler(async (req, res) => {
    try {
      const { domain } = req.body || {};
      if (!domain) return res.status(400).json({ ok: false, error: "domain required" });
      const mod = await import("../emergent/ingest-engine.js").catch(() => null);
      if (!mod?.addToBlocklist) return res.status(501).json({ ok: false, error: "Block not available" });
      mod.addToBlocklist(domain);
      return res.json({ ok: true, blocked: domain });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // Jobs status endpoint
  app.get("/api/jobs/status", (req, res) => {
    try {
      const jobs = Array.from(STATE.jobs.values());
      const summary = {
        total: jobs.length,
        queued: jobs.filter(j => j.status === "queued").length,
        running: jobs.filter(j => j.status === "running").length,
        completed: jobs.filter(j => j.status === "completed").length,
        failed: jobs.filter(j => j.status === "failed").length,
        cancelled: jobs.filter(j => j.status === "cancelled").length
      };
      return res.json({
        ok: true,
        summary,
        jobs: jobs.slice(0, 100).map(j => ({
          id: j.id,
          type: j.type,
          status: j.status,
          progress: j.progress || 0,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt
        }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Toggle job enabled/disabled
  app.post("/api/jobs/toggle", (req, res) => {
    try {
      const { job: jobName, enabled } = req.body || {};
      if (!jobName) return res.status(400).json({ ok: false, error: "job name required" });

      // Find jobs matching the name/type
      let toggled = 0;
      for (const [_id, job] of STATE.jobs) {
        if (job.type === jobName || job.name === jobName) {
          job.enabled = enabled !== false;
          job.updatedAt = nowISO();
          toggled++;
        }
      }

      saveStateDebounced();
      return res.json({ ok: true, toggled, enabled: enabled !== false });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Global simulation / publish (explicit) ---
  app.post("/api/global/propose", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("global","propose", req.body||{}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  app.post("/api/global/publish", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("global","publish", req.body||{}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  app.get("/api/global/index", (req,res) => {
    try {
      const byId = STATE.globalIndex?.byId;
      const byHash = STATE.globalIndex?.byHash;
      return res.json({
        ok:true,
        counts: { byId: byId?.size||0, byHash: byHash?.size||0 },
        sample: { ids: byId ? Array.from(byId.keys()).slice(0,50) : [], hashes: byHash ? Array.from(byHash.keys()).slice(0,50) : [] }
      });
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // --- Marketplace simulation (explicit) ---
  app.post("/api/market/listing", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("market","listingCreate", req.body||{}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  app.get("/api/market/listings", asyncHandler(async (req,res) => {
    try {
      const input = { limit: Number(req.query?.limit||50), offset: Number(req.query?.offset||0) };
      return res.json(await runMacro("market","list", input, makeCtx(req)));
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  }));

  app.post("/api/market/buy", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("market","buy", req.body||{}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  app.get("/api/market/library", asyncHandler(async (req,res) => {
    try { return res.json(await runMacro("market","library", {}, makeCtx(req))); }
    catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  }));

  // Style
  app.get("/api/style/:sessionId", asyncHandler(async (req, res) => {
    const out = await runMacro("style", "get", { sessionId: req.params.sessionId }, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/style/mutate", asyncHandler(async (req, res) => {
    const out = await runMacro("style", "mutate", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Verify endpoints
  app.post("/api/verify/feasibility", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "feasibility", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/verify/designScore", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "designScore", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/verify/conflictCheck", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "conflictCheck", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/verify/stressTest", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "stressTest", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/verify/deriveSecondOrder", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "deriveSecondOrder", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "derive" }));
  }));

  app.post("/api/verify/lineageLink", asyncHandler(async (req, res) => {
    const out = await runMacro("verify", "lineageLink", req.body, makeCtx(req));
    return res.json(out);
  }));

  // Experiments
  app.post("/api/experiments", asyncHandler(async (req, res) => {
    const out = await runMacro("experiment", "log", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "experiment" }));
  }));

  app.get("/api/experiments", (req, res) => {
    const experiments = userVisibleDTUs().filter(d => (d.tags || []).includes("experiment"));
    return res.json({ ok: true, experiments });
  });

  app.get("/api/experiments/:id", (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu || !(dtu.tags || []).includes("experiment")) {
      return res.status(404).json({ ok: false, error: "Experiment not found" });
    }
    return res.json({ ok: true, experiment: dtu });
  });

  // Synth + evolution
  app.post("/api/synth/combine", asyncHandler(async (req, res) => {
    const out = await runMacro("synth", "combine", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "synth" }));
  }));

  app.post("/api/evolution/dedupe", asyncHandler(async (req, res) => {
    const out = await runMacro("evolution", "dedupe", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "evolution_dedupe" }));
  }));

  app.post("/api/heartbeat/tick", asyncHandler(async (req, res) => {
    const out = await runMacro("heartbeat", "tick", req.body, makeCtx(req));
    return res.json(out);
  }));

  // System maintenance
  app.post("/api/system/continuity", asyncHandler(async (req, res) => {
    const out = await runMacro("system", "continuity", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "continuity" }));
  }));

  app.post("/api/system/gap-scan", asyncHandler(async (req, res) => {
    const out = await runMacro("system", "gapScan", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/system/promotion-tick", asyncHandler(async (req, res) => {
    const out = await runMacro("system", "promotionTick", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state", "queues"], ["/api/dtus", "/api/state/latest", "/api/queues"], null, { panel: "promotion" }));
  }));

  // Temporal frames
  app.get("/api/temporal/frames", (req, res) => {
    const frames = Object.values(TEMPORAL_FRAMES);
    return res.json({ ok: true, frames });
  });

  // Proposals
  app.get("/api/proposals", (req,res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit||50)));
    res.json({ ok:true, proposals: pipeListProposals(limit), total: PIPE.proposals.size });
  });

  app.get("/api/proposals/:id", (req, res) => {
    const proposal = PIPE.proposals.get(req.params.id);
    if (!proposal) return res.status(404).json({ ok: false, error: "Proposal not found" });
    return res.json({ ok: true, proposal });
  });

  app.post("/api/proposals/:id/approve", (req, res) => {
    const proposal = PIPE.proposals.get(req.params.id);
    if (!proposal) return res.status(404).json({ ok: false, error: "Proposal not found" });

    proposal.status = "approved";
    proposal.approvedAt = nowISO();
    proposal.approvedBy = req.actor?.userId || "anon";
    saveStateDebounced();

    return res.json({ ok: true, proposal });
  });

  app.post("/api/proposals/:id/reject", (req, res) => {
    const proposal = PIPE.proposals.get(req.params.id);
    if (!proposal) return res.status(404).json({ ok: false, error: "Proposal not found" });

    proposal.status = "rejected";
    proposal.rejectedAt = nowISO();
    proposal.rejectedBy = req.actor?.userId || "anon";
    proposal.rejectReason = req.body?.reason || "";
    saveStateDebounced();

    return res.json({ ok: true, proposal });
  });

  // Jobs cancel/retry
  app.post("/api/jobs/:id/cancel", (req, res) => {
    const job = STATE.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    if (job.status === "running") {
      return res.status(400).json({ ok: false, error: "Cannot cancel running job" });
    }

    job.status = "cancelled";
    job.updatedAt = nowISO();
    saveStateDebounced();

    return res.json({ ok: true, job });
  });

  app.post("/api/jobs/:id/retry", (req, res) => {
    const job = STATE.jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    if (job.status !== "failed") {
      return res.status(400).json({ ok: false, error: "Can only retry failed jobs" });
    }

    job.status = "queued";
    job.attempts = 0;
    job.lastError = null;
    job.runAt = nowISO();
    job.updatedAt = nowISO();
    saveStateDebounced();

    return res.json({ ok: true, job });
  });

  // Agents
  app.post("/api/agents", asyncHandler(async (req, res) => {
    const out = await runMacro("agent", "create", req.body, makeCtx(req));
    return res.json(out);
  }));

  app.get("/api/agents", (req, res) => {
    const agents = Array.from(STATE.personas.values()).filter(p =>
      p && p.goal // Simple heuristic: agents have goals
    );
    return res.json({ ok: true, agents });
  });

  // GET /api/agents/status — Aggregate agent system status with metrics (must be before :id)
  app.get("/api/agents/status", async (_req, res) => {
    try {
      const mod = await import("../emergent/agent-system.js");
      const list = mod.listAgents();
      const metrics = mod.getAgentMetrics();
      const agents = list.agents || [];
      return res.json({
        ok: true,
        agentCount: agents.length,
        active: agents.filter(a => a.status === "active").length,
        paused: agents.filter(a => a.status === "paused").length,
        frozen: metrics.metrics?.globalFrozen || false,
        agents: agents.map(a => ({
          agentId: a.agentId,
          type: a.type,
          status: a.status,
          territory: a.territory,
          runCount: a.runCount,
          findingsCount: a.findingsCount,
          repairsCount: a.repairsCount,
          lastRunAt: a.lastRunAt,
          createdAt: a.createdAt,
        })),
        metrics: metrics.metrics || {},
      });
    } catch (e) {
      return res.json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/agents/:id", (req, res) => {
    const agent = STATE.personas.get(req.params.id);
    if (!agent || !agent.goal) {
      return res.status(404).json({ ok: false, error: "Agent not found" });
    }
    return res.json({ ok: true, agent });
  });

  app.post("/api/agents/:id/enable", asyncHandler(async (req, res) => {
    const out = await runMacro("agent", "enable", { id: req.params.id, enabled: req.body.enabled }, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/agents/:id/tick", asyncHandler(async (req, res) => {
    const out = await runMacro("agent", "tick", { id: req.params.id, prompt: req.body.prompt }, makeCtx(req));
    return res.json(out);
  }));

  // POST /api/agents/spawn-research — Spawn a research agent for a given topic
  app.post("/api/agents/spawn-research", asyncHandler(async (req, res) => {
    try {
      const { topic } = req.body || {};
      if (!topic) return res.status(400).json({ ok: false, error: "topic required" });
      const mod = await import("../emergent/agent-system.js");
      const result = mod.createAgent("synthesis", {
        territory: "*",
        metadata: { purpose: "research", topic, createdBy: "user", spawnedAt: new Date().toISOString() },
      });
      if (!result.ok) return res.json(result);
      // Immediately run the agent with DTUs related to the topic
      const dtus = Array.from(STATE.dtus?.values?.() || []).filter(d => {
        const text = `${d.title || ""} ${d.summary || ""} ${(d.tags || []).join(" ")}`.toLowerCase();
        return text.includes(topic.toLowerCase());
      }).slice(0, 200);
      const runResult = mod.runAgent(result.agent.agentId, dtus);
      return res.json({
        ok: true,
        agent: result.agent,
        findings: runResult.findings || [],
        findingsCount: runResult.count || 0,
        topic,
      });
    } catch (e) {
      return res.json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // Reseed
  app.post("/api/reseed", requireRole("owner", "admin"), asyncHandler(async (req, res) => {
    try {
      const force = req.body?.force === true;
      if (!force && (STATE.dtus?.size || 0) > 0) {
        return res.json({ ok: false, error: "DTUs already exist. Pass { force: true } to reseed anyway.", currentCount: STATE.dtus?.size || 0 });
      }
      const seeds = await tryLoadSeedDTUs();
      if (!seeds.length) {
        return res.json({ ok: false, error: SEED_INFO.error || "No seeds found in dtus.js", seedInfo: SEED_INFO });
      }
      let added = 0;
      for (const s of seeds) {
        // Scope Separation: reseeded DTUs enter Global scope (canonical knowledge)
        s.scope = "global";
        const d = toOptionADTU(s);
        if (!STATE.dtus?.has(d.id)) {
          STATE.dtus?.set(d.id, d);
          added++;
        }
      }
      saveStateDebounced();
      return res.json({ ok: true, added, total: STATE.dtus?.size || 0, scope: "global", seedInfo: SEED_INFO });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // Abstraction governor status / controls
  app.get("/api/abstraction", (req, res) => {
    try {
      const snap = computeAbstractionSnapshot();
      res.json({ ok:true, abstraction: { ...STATE.abstraction, metrics: { ...STATE.abstraction.metrics, ...snap } } });
    } catch (e) {
      res.json({ ok:false, error: String(e?.message||e) });
    }
  });

  app.post("/api/abstraction/upgrade", asyncHandler(async (req, res) => {
    try {
      // force a local upgrade now
      STATE.abstraction.lastUpgradeAt = null;
      const r = await maybeRunLocalUpgrade();
      res.json({ ok:true, result: r, abstraction: STATE.abstraction });
    } catch (e) {
      res.json({ ok:false, error: String(e?.message||e) });
    }
  }));

  // Manual consolidation trigger - creates MEGAs/HYPERs immediately
  app.post("/api/abstraction/consolidate", requireRole("owner", "admin"), asyncHandler(async (req, res) => {
    try {
      const { maxMegas = 5, maxHypers = 2, force = false } = req.body || {};

      // Optionally bypass usage requirement for testing/manual consolidation
      if (force) {
        STATE.abstraction.metrics = STATE.abstraction.metrics || {};
        STATE.abstraction.metrics.totalUses = Math.max(STATE.abstraction.metrics.totalUses || 0, 30);
      }

      const ctx = makeCtx(req);
      const result = await runAutoPromotion(ctx, { maxNewMegas: maxMegas, maxNewHypers: maxHypers });

      res.json({
        ok: true,
        result,
        message: result.made?.megas?.length || result.made?.hypers?.length
          ? `Created ${result.made?.megas?.length || 0} MEGAs and ${result.made?.hypers?.length || 0} HYPERs`
          : "No consolidation needed (insufficient clusters or already at budget)"
      });
    } catch (e) {
      res.json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // ---- Queues (proposals + maintenance; never flood DTU library) ----
  app.get("/api/queues", (req,res)=>{
    ensureQueues();
    res.json({ ok:true, queues: Object.fromEntries(Object.entries(STATE.queues).map(([k,v])=>[k, v.slice(-500)])) });
  });

  app.post("/api/queues/:queue/propose", (req,res)=>{
    ensureQueues();
    const q = String(req.params.queue||"");
    if (!STATE.queues[q]) return res.status(404).json({ ok:false, error:`Unknown queue: ${q}` });
    const raw = (req.body&&typeof req.body==='object') ? req.body : {};
    const { title, description, content, tags, priority, meta, proposerOrganId, type: itemType } = raw;
    const item = { id: uid(`q_${q}`), createdAt: nowISO(), status: "queued", title, description, content, tags, priority, meta, proposerOrganId, type: itemType };
    STATE.queues[q].push(item);
    saveStateDebounced();
    res.json({ ok:true, item });
  });

  app.post("/api/queues/:queue/decide", asyncHandler(async (req,res)=>{
    ensureQueues();
    const q = String(req.params.queue||"");
    if (!STATE.queues[q]) return res.status(404).json({ ok:false, error:`Unknown queue: ${q}` });
    const { id, decision, note } = req.body||{};
    const item = STATE.queues[q].find(x=>x && x.id===id);
    if (!item) return res.status(404).json({ ok:false, error:"Queue item not found" });
    const dec = String(decision||"").toLowerCase();
    if (!['approve','decline','revise','promote'].includes(dec)) return res.status(400).json({ ok:false, error:"decision must be approve/decline/revise/promote" });

    item.status = dec;
    item.decidedAt = nowISO();
    item.decisionNote = note || "";

    // Promotion hook: approved DTU proposals become DTUs (lineage preserved)
    let promoted = null;
    if ((dec==='approve' || dec==='promote') && item.type === 'dtu_proposal' && item.payload && typeof item.payload==='object') {
      const ctx = makeCtx(req);
      const spec = { ...item.payload, source: item.payload.source || `queue.${q}`, allowRewrite: true };
      const r = await runMacro('dtu','create', spec, ctx).catch(e=>({ ok:false, error:String(e?.message||e) }));
      promoted = r;
      item.promoted = r?.ok ? { dtuId: r.id || r.dtu?.id || null } : null;
    }

    saveStateDebounced();
    res.json({ ok:true, item, promoted });
  }));

  // DELETE /api/queue/:id — remove a queue item by id (searches all queues)
  app.delete("/api/queue/:id", (req, res) => {
    ensureQueues();
    const targetId = req.params.id;
    for (const [qName, items] of Object.entries(STATE.queues)) {
      if (!Array.isArray(items)) continue;
      const idx = items.findIndex(x => x && x.id === targetId);
      if (idx !== -1) {
        items.splice(idx, 1);
        saveStateDebounced();
        return res.json({ ok: true, queue: qName, removedId: targetId });
      }
    }
    return res.status(404).json({ ok: false, error: "Queue item not found" });
  });

  // ── Organism Pipeline Status (Feature 47) ────────────────────────────────
  // Unified status view of the proposal-verify-council-commit pipeline,
  // WAL health, snapshot state, and recent commit history.

  app.get("/api/organism/pipeline/status", (req, res) => {
    try {
      const proposals = Array.from(PIPE.proposals.values());
      const now = Date.now();

      // Categorize proposals by status
      const pending = proposals.filter(p => p.status === "proposed");
      const verified = proposals.filter(p => p.status === "verified");
      const approved = proposals.filter(p => p.status === "approved");
      const rejected = proposals.filter(p => p.status === "rejected");

      // Recent commits (approved in last 24h)
      const oneDayAgo = new Date(now - 86400000).toISOString();
      const recentCommits = approved
        .filter(p => (p.updatedAt || p.createdAt) >= oneDayAgo)
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
        .slice(0, 20)
        .map(p => ({
          id: p.id,
          action: p.action,
          status: p.status,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          dtuTitle: p.payload?.dtu?.title?.slice(0, 80) || null,
          actor: p.actor,
        }));

      // WAL file size
      let walSizeBytes = 0;
      let walExists = false;
      try {
        const stat = fs.statSync(PIPE.walPath);
        walSizeBytes = stat.size;
        walExists = true;
      } catch (_e) { /* WAL may not exist yet */ }

      // Snapshot directory count
      let snapshotCount = 0;
      let latestSnapshot = null;
      try {
        const entries = fs.readdirSync(PIPE.snapshotsDir).filter(e => e.startsWith("snap_"));
        snapshotCount = entries.length;
        if (entries.length > 0) {
          latestSnapshot = entries.sort().pop();
        }
      } catch (_e) { /* snapshots dir may not exist */ }

      res.json({
        ok: true,
        pipeline: {
          enabled: PIPE.enabled,
          totalProposals: proposals.length,
          pending: pending.length,
          verified: verified.length,
          approved: approved.length,
          rejected: rejected.length,
          verificationQueue: pending.length + verified.length,
          councilPending: verified.length,
        },
        wal: {
          exists: walExists,
          sizeBytes: walSizeBytes,
          sizeFormatted: walSizeBytes < 1024 ? `${walSizeBytes}B`
            : walSizeBytes < 1048576 ? `${(walSizeBytes / 1024).toFixed(1)}KB`
            : `${(walSizeBytes / 1048576).toFixed(1)}MB`,
          path: PIPE.walPath,
        },
        snapshots: {
          count: snapshotCount,
          latest: latestSnapshot,
          dir: PIPE.snapshotsDir,
        },
        recentCommits,
        health: {
          pipelineEnabled: PIPE.enabled,
          walHealthy: walExists || proposals.length === 0,
          proposalBacklog: pending.length > 50 ? "high" : pending.length > 10 ? "medium" : "low",
          status: PIPE.enabled
            ? (pending.length > 50 ? "degraded" : "healthy")
            : "disabled",
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
