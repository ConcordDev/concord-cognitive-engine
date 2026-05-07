/**
 * Domain routes — extracted from server.js
 * Covers: forge, swarm, sim, wrappers, layers, personas, macros, GRC, settings,
 *         dream/autogen/evolution/synthesize, crawl, temporal, dimensional,
 *         council, scope, anon, research, materials, interface/tabs, logs,
 *         papers, audit, lattice, persona/create, skill, intent, chicken3,
 *         goals, worldmodel, semantic, transfer, experience, attention,
 *         reflection, commonsense, grounding, reasoning, inference, hypothesis,
 *         metacognition, explanation, metalearning, multimodal, voice, tools,
 *         entity, sessions, search, stats, cognitive/status
 */
import path from "path";
import { asyncHandler } from "../lib/async-handler.js";
export default function registerDomainRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  _withAck,
  kernelTick,
  uiJson,
  listDomains,
  listMacros,
  _dtusArray,
  _normalizeText,
  clamp,
  _nowISO,
  saveStateDebounced,
  retrieveDTUs,
  _isShadowDTU,
  fs,
  ensureExperienceLearning,
  ensureAttentionManager,
  ensureReflectionEngine,
  validate
}) {

  // ---- Cognitive Status ----
  app.get("/api/cognitive/status", (req, res) => {
    try {
      ensureExperienceLearning();
      ensureAttentionManager();
      ensureReflectionEngine();

      // Goals
      const goals = (() => {
        try {
          const active = Array.from(STATE.goals?.active || [])
            .map(gid => STATE.goals?.registry?.get?.(gid)).filter(Boolean)
            .slice(0, 10)
            .map(g => ({ id: g.id, description: g.description || g.goal, priority: g.priority, status: g.status }));
          return { activeCount: STATE.goals?.active?.size || 0, totalRegistered: STATE.goals?.registry?.size || 0, active };
        } catch (_e) { return null; }
      })();

      // Hypothesis engine
      const hypothesis = (() => {
        try {
          const hs = STATE.hypotheses;
          if (!hs) return null;
          return { active: hs.active?.size || hs.active?.length || 0, tested: hs.tested || 0, confirmed: hs.confirmed || 0 };
        } catch (_e) { return null; }
      })();

      // Metacognition
      const metacognition = (() => {
        try {
          const mc = STATE.metacognition;
          if (!mc) return null;
          return { predictions: mc.predictions?.length || 0, blindSpots: mc.blindSpots?.length || 0, calibration: mc.calibrationScore ?? null };
        } catch (_e) { return null; }
      })();

      // World model
      const worldModel = (() => {
        try {
          const wm = STATE.worldModel;
          if (!wm) return null;
          return { entities: wm.entities?.size || 0, relations: wm.relations?.size || 0 };
        } catch (_e) { return null; }
      })();

      // Reasoning chains
      const reasoning = (() => {
        try {
          const r = STATE.reasoning;
          if (!r) return null;
          return { chains: r.chains?.size || 0, steps: r.steps?.size || 0 };
        } catch (_e) { return null; }
      })();

      return res.json({
        ok: true,
        experience: {
          episodes: STATE.experienceLearning?.episodes?.length || 0,
          patterns: STATE.experienceLearning?.patterns?.size || 0,
          strategies: STATE.experienceLearning?.strategies?.size || 0,
        },
        attention: {
          focus: STATE.attention?.focus || null,
          activeThreads: typeof STATE.attention?.threads?.values === "function" ? Array.from(STATE.attention.threads.values()).filter(t => t.status === "active").length : 0,
          queueLength: STATE.attention?.queue?.length || 0,
        },
        reflection: {
          calibration: STATE.reflection?.selfModel?.confidenceCalibration || 0,
          strengths: STATE.reflection?.selfModel?.strengths || [],
          weaknesses: STATE.reflection?.selfModel?.weaknesses || [],
          reflections: STATE.reflection?.reflections?.length || 0,
        },
        goals,
        hypothesis,
        metacognition,
        worldModel,
        reasoning,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- Forge ----
  app.post("/api/forge/manual", validate("forgeManual"), asyncHandler(async (req,res)=> {
    const out = await runMacro("forge","manual", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus","state","logs"], ["/api/dtus","/api/state/latest","/api/logs"], null, { panel: "forge_manual" }));
  }));
  app.post("/api/forge/hybrid", validate("forgeAuto"), asyncHandler(async (req,res)=> {
    const out = await runMacro("forge","hybrid", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus","state","logs"], ["/api/dtus","/api/state/latest","/api/logs"], null, { panel: "forge_hybrid" }));
  }));
  app.post("/api/forge/auto", validate("forgeAuto"), asyncHandler(async (req,res)=> {
    const out = await runMacro("forge","auto", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus","state","logs"], ["/api/dtus","/api/state/latest","/api/logs"], null, { panel: "forge_auto" }));
  }));
  app.post("/api/forge/fromSource", asyncHandler(async (req, res) => {
    const out = await runMacro("forge", "fromSource", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "forge_from_source" }));
  }));

  // ---- Swarm + Sim ----
  app.post("/api/swarm", asyncHandler(async (req,res)=> {
    const out = await runMacro("swarm","run", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["state","logs"], ["/api/state/latest","/api/logs"], null, { panel: "swarm" }));
  }));
  app.post("/api/sim", asyncHandler(async (req,res)=> {
    const out = await runMacro("sim","run", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["state","logs"], ["/api/state/latest","/api/logs"], null, { panel: "sim" }));
  }));
  app.get("/api/sim/:id", (req,res)=> res.json({ ok:true, note:"Single-run sims are stored as lastSim only in this v2 build.", lastSim: STATE.lastSim || null }));

  // ---- Wrappers ----
  app.get("/api/wrappers", asyncHandler(async (req,res)=> res.json(await runMacro("wrapper","list", {}, makeCtx(req)))));
  app.post("/api/wrappers", asyncHandler(async (req,res)=> res.json(await runMacro("wrapper","create", req.body||{}, makeCtx(req)))));
  app.post("/api/wrappers/run", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("wrapper","run", req.body || {}, ctx);
    kernelTick({ type: out?.ok ? "WRAPPER_RUN" : "VERIFIER_FAIL", meta: { path: req.path }, signals: { benefit: out?.ok?0.2:0, error: out?.ok?0:0.3 } });
    return uiJson(res, _withAck(out, req, ["state","logs"], ["/api/state/latest","/api/logs"], null, { panel: "wrapper_run" }), req, { panel: "wrapper_run" });
  }));

  // ---- Layers ----
  app.get("/api/layers", asyncHandler(async (req,res)=> res.json(await runMacro("layer","list", {}, makeCtx(req)))));
  app.post("/api/layers", asyncHandler(async (req,res)=> res.json(await runMacro("layer","create", req.body||{}, makeCtx(req)))));
  app.post("/api/layers/toggle", asyncHandler(async (req,res)=> res.json(await runMacro("layer","toggle", req.body||{}, makeCtx(req)))));

  // ---- Personas ----
  app.get("/api/personas", asyncHandler(async (req,res)=> res.json(await runMacro("persona","list", {}, makeCtx(req)))));
  app.post("/api/personas", asyncHandler(async (req,res)=> res.json(await runMacro("persona","create", req.body||{}, makeCtx(req)))));
  app.post("/api/personas/:id/speak", asyncHandler(async (req, res) => {
    const out = await runMacro("persona", "speak", { personaId: req.params.id, text: req.body?.text || "" }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/personas/:id/animate", asyncHandler(async (req, res) => {
    const out = await runMacro("persona", "animate", { personaId: req.params.id, kind: req.body?.kind || "talk" }, makeCtx(req));
    return res.json(out);
  }));
  app.put("/api/personas/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("persona", "update", { id: req.params.id, ...req.body }, makeCtx(req));
    return res.json(out);
  }));
  app.delete("/api/personas/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("persona", "delete", { id: req.params.id }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/persona/create", asyncHandler(async (req, res) => {
    const out = await runMacro("persona", "create", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Macros registry + runner ----
  app.get("/api/macros/domains", (req,res)=> res.json({ ok:true, domains: listDomains() }));
  app.get("/api/macros/:domain", (req,res)=> res.json({ ok:true, domain:req.params.domain, macros: listMacros(req.params.domain) }));

  // Feature 46: Macro Explorer — all macros across all domains in one call
  app.get("/api/admin/macros", (req, res) => {
    const domains = listDomains();
    const all = [];
    for (const domain of domains) {
      const macros = listMacros(domain);
      for (const m of macros) {
        all.push({ domain, name: m.name, description: m.description || "", public: !!m.public, plugin: m.plugin || null });
      }
    }
    res.json({ ok: true, macros: all, domainCount: domains.length, totalMacros: all.length });
  });
  app.post("/api/macros/run", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    let domain = req.body?.domain;
    let name = req.body?.name;
    const input = req.body?.input || req.body?.ctx || {};

    // Support recipeName format: "emergent.list" → domain="emergent", name="list"
    if (!domain && req.body?.recipeName) {
      const parts = req.body.recipeName.split(".");
      domain = parts[0];
      name = parts.slice(1).join(".");
    }

    if (!domain || !name) return res.status(400).json({ ok:false, error:"domain and name required" });
    try {
      const out = await runMacro(domain, name, input, ctx);
      kernelTick({ type: "MACRO_RUN", meta: { path: req.path, domain, name }, signals: { benefit: out?.ok?0.1:0, error: out?.ok?0:0.2 } });
      return uiJson(res, _withAck(out, req, ["state","logs"], ["/api/state/latest","/api/logs"], null, { panel: "macro_run", domain, name }), req, { panel: "macro_run", domain, name });
    } catch (e) {
      kernelTick({ type: "ERROR", meta: { path: req.path, domain, name }, signals: { error: 0.4 } });
      const msg = String(e?.message || e);
      if (msg.startsWith("forbidden:")) {
        const permission = msg.replace("forbidden:", "").trim();
        return res.status(403).json({ ok:false, error: `Permission denied: ${permission}`, code: "PERMISSION_DENIED", permission });
      }
      return res.status(404).json({ ok:false, reply: msg, error: msg });
    }
  }));

  // ---- GRC v1 ----
  app.get("/api/grc/schema", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("grc", "schema", {}, ctx);
    res.json(out);
  }));
  app.get("/api/grc/invariants", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("grc", "invariants", {}, ctx);
    res.json(out);
  }));
  app.get("/api/grc/metrics", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("grc", "metrics", {}, ctx);
    res.json(out);
  }));
  app.post("/api/grc/format", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("grc", "format", req.body || {}, ctx);
    res.json(out);
  }));
  app.post("/api/grc/validate", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("grc", "validate", req.body || {}, ctx);
    res.json(out);
  }));

  // ---- Interface + Logs ----
  app.get("/api/interface/tabs", asyncHandler(async (req,res)=> res.json(await runMacro("interface","tabs", {}, makeCtx(req)))));
  app.get("/api/logs", asyncHandler(async (req,res)=> res.json(await runMacro("log","list", { limit: req.query.limit }, makeCtx(req)))));

  // ---- Crawl + Autocrawl ----
  app.post("/api/crawl", asyncHandler(async (req,res)=> {
    const ctx = makeCtx(req);
    const out = await runMacro("ingest","url", req.body||{}, ctx);
    res.json(out);
  }));
  app.post("/api/autocrawl/queue", asyncHandler(async (req,res)=> {
    const ctx = makeCtx(req);
    const out = await runMacro("ingest","queue", req.body||{}, ctx);
    res.json(out);
  }));
  app.post("/api/crawl/enqueue", asyncHandler(async (req, res) => {
    const out = await runMacro("crawl", "enqueue", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/crawl/fetch", asyncHandler(async (req, res) => {
    const out = await runMacro("crawl", "fetch", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Settings ----
  app.get("/api/settings", asyncHandler(async (req,res)=> res.json(await runMacro("settings","get", {}, makeCtx(req)))));
  app.post("/api/settings", asyncHandler(async (req,res)=> res.json(await runMacro("settings","set", req.body||{}, makeCtx(req)))));

  // ---- System: dream/autogen/evolution/synthesize ----
  app.post("/api/dream", asyncHandler(async (req,res)=> res.json(await runMacro("system","dream", req.body||{}, makeCtx(req)))));
  app.post("/api/autogen", asyncHandler(async (req,res)=> res.json(await runMacro("system","autogen", req.body||{}, makeCtx(req)))));
  app.post("/api/evolution", asyncHandler(async (req,res)=> res.json(await runMacro("system","evolution", req.body||{}, makeCtx(req)))));
  app.post("/api/synthesize", asyncHandler(async (req,res)=> res.json(await runMacro("system","synthesize", req.body||{}, makeCtx(req)))));

  // ---- Materials ----
  app.post("/api/materials/test", asyncHandler(async (req,res)=> res.json(await runMacro("materials","test", req.body||{}, makeCtx(req)))));

  // ---- Research ----
  app.post("/api/research/math", asyncHandler(async (req,res)=> res.json(await runMacro("research","math.exec", req.body||{}, makeCtx(req)))));
  app.get("/api/research/constants", asyncHandler(async (req, res) => {
    const out = await runMacro("research", "physics.constants", { keys: req.query.keys?.split(',') }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/research/kinematics", asyncHandler(async (req, res) => {
    const out = await runMacro("research", "physics.kinematics", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/research/truthgate", asyncHandler(async (req, res) => {
    const out = await runMacro("research", "truthgate.check", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Temporal ----
  app.post("/api/temporal/validate", asyncHandler(async (req,res)=> res.json(await runMacro("temporal","validate", req.body, makeCtx(req)))));
  app.post("/api/temporal/recency", asyncHandler(async (req,res)=> res.json(await runMacro("temporal","recency", req.body, makeCtx(req)))));
  app.post("/api/temporal/frame", asyncHandler(async (req,res)=> res.json(await runMacro("temporal","frame", req.body, makeCtx(req)))));
  app.post("/api/temporal/subjective", asyncHandler(async (req,res)=> res.json(await runMacro("temporal","subjective", req.body, makeCtx(req)))));
  app.post("/api/temporal/sim", asyncHandler(async (req,res)=> res.json(await runMacro("temporal","simTimeline", req.body, makeCtx(req)))));

  // ---- Dimensional ----
  app.post("/api/dimensional/validate", asyncHandler(async (req,res)=> res.json(await runMacro("dimensional","validateContext", req.body||{}, makeCtx(req)))));
  app.post("/api/dimensional/invariance", asyncHandler(async (req,res)=> res.json(await runMacro("dimensional","checkInvariance", req.body||{}, makeCtx(req)))));
  app.post("/api/dimensional/scale", asyncHandler(async (req,res)=> res.json(await runMacro("dimensional","scaleTransform", req.body||{}, makeCtx(req)))));

  // ---- Council ----
  app.post("/api/council/review-global", asyncHandler(async (req,res)=> res.json(await runMacro("council","reviewGlobal", req.body||{}, makeCtx(req)))));
  app.post("/api/council/weekly", asyncHandler(async (req,res)=> res.json(await runMacro("council","weeklyDebateTick", req.body||{}, makeCtx(req)))));
  app.post("/api/council/vote", asyncHandler(async (req, res) => {
    const out = await runMacro("council", "vote", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/council/tally/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("council", "tally", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/council/credibility", asyncHandler(async (req, res) => {
    const out = await runMacro("council", "credibility", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Scope Separation ----
  app.post("/api/scope/promote", asyncHandler(async (req,res)=> res.json(await runMacro("emergent","scope.promote", req.body||{}, makeCtx(req)))));
  app.post("/api/scope/validate-global", asyncHandler(async (req,res)=> res.json(await runMacro("emergent","scope.validateGlobal", req.body||{}, makeCtx(req)))));
  app.get("/api/scope/metrics", asyncHandler(async (req, res) => {
    try {
      const result = await Promise.race([
        runMacro("emergent", "scope.metrics", {}, makeCtx(req)),
        new Promise((_, reject) => { setTimeout(() => reject(new Error("scope.metrics timeout")), 8000); }),
      ]);
      res.json(result);
    } catch (e) {
      const sz = STATE.dtus?.size || 0;
      res.json({ ok: true, local: sz, marketplace: 0, global: sz, total: sz, localCount: sz, globalCount: sz, error: e.message, timeout: true });
    }
  }));
  app.get("/api/scope/dtus/:scope", asyncHandler(async (req,res)=> res.json(await runMacro("emergent","scope.listByScope", { scope: req.params.scope, limit: Number(req.query.limit||50) }, makeCtx(req)))));
  app.get("/api/scope/overrides", asyncHandler(async (req,res)=> res.json(await runMacro("emergent","scope.overrideLog", { limit: Number(req.query.limit||50) }, makeCtx(req)))));
  app.get("/api/scope/marketplace-analytics", asyncHandler(async (req,res)=> res.json(await runMacro("emergent","scope.marketplaceAnalytics", { limit: Number(req.query.limit||50) }, makeCtx(req)))));

  // ---- Anonymous Messaging ----
  app.post("/api/anon/create", asyncHandler(async (req,res)=> res.json(await runMacro("anon","create", req.body||{}, makeCtx(req)))));
  app.post("/api/anon/send", asyncHandler(async (req,res)=> res.json(await runMacro("anon","send", req.body||{}, makeCtx(req)))));
  app.post("/api/anon/inbox", asyncHandler(async (req,res)=> res.json(await runMacro("anon","inbox", req.body||{}, makeCtx(req)))));
  app.post("/api/anon/decrypt-local", asyncHandler(async (req,res)=> res.json(await runMacro("anon","decryptLocal", req.body||{}, makeCtx(req)))));

  // ---- Papers ----
  app.post("/api/papers", asyncHandler(async (req, res) => {
    const out = await runMacro("paper", "create", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/papers", (req, res) => {
    const papers = Array.from(STATE.papers?.values?.() || []);
    return res.json({ ok: true, papers });
  });
  app.get("/api/papers/:id", (req, res) => {
    const paper = STATE.papers?.get(req.params.id);
    if (!paper) return res.status(404).json({ ok: false, error: "Paper not found" });
    return res.json({ ok: true, paper });
  });
  app.post("/api/papers/:id/build", asyncHandler(async (req, res) => {
    const out = await runMacro("paper", "build", { paperId: req.params.id }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/papers/:id/export", asyncHandler(async (req, res) => {
    const out = await runMacro("paper", "export", { paperId: req.params.id, format: req.query.format || "md" }, makeCtx(req));
    if (!out.ok) return res.status(500).json(out);
    const fpath = out.file?.path;
    if (!fpath) return res.status(404).json({ ok: false, error: "Export file not found" });
    // Path traversal protection: ensure resolved path is within allowed exports directory
    const allowedBase = path.resolve(process.cwd(), "data", "exports");
    const resolved = path.resolve(fpath);
    if (!resolved.startsWith(allowedBase + path.sep) && resolved !== allowedBase) {
      return res.status(403).json({ ok: false, error: "Access denied: path outside allowed directory" });
    }
    if (fs.existsSync(resolved)) {
      return res.sendFile(resolved);
    }
    return res.status(404).json({ ok: false, error: "Export file not found" });
  }));

  // ---- Audit ----
  app.get("/api/audit", asyncHandler(async (req, res) => {
    const out = await runMacro("audit", "query", {
      limit: req.query.limit,
      domain: req.query.domain,
      contains: req.query.contains
    }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Lattice ----
  app.post("/api/lattice/birth", asyncHandler(async (req, res) => {
    const out = await runMacro("lattice", "birth_protocol", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Skill ----
  app.post("/api/skill/create", asyncHandler(async (req, res) => {
    const out = await runMacro("skill", "create", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Intent ----
  app.post("/api/intent/rhythmic", asyncHandler(async (req, res) => {
    const out = await runMacro("intent", "rhythmic_intent", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Chicken3 Meta ----
  app.post("/api/chicken3/meta/propose", asyncHandler(async (req, res) => {
    const out = await runMacro("chicken3", "meta_propose", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/chicken3/meta/commit", asyncHandler(async (req, res) => {
    const out = await runMacro("chicken3", "meta_commit_quiet", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Goals ----
  app.get("/api/goals/status", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "status", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/goals", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "list", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/goals/:goalId", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "get", { goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "propose", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/evaluate", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "evaluate", { ...req.body, goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/approve", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "approve", { ...req.body, goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/activate", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "activate", { ...req.body, goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/progress", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "progress", { ...req.body, goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/complete", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "complete", { goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/:goalId/abandon", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "abandon", { ...req.body, goalId: req.params.goalId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/auto-propose", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "auto_propose", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/goals/config", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "config", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/goals/config", asyncHandler(async (req, res) => {
    const out = await runMacro("goals", "config", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- World Model ----
  app.get("/api/worldmodel/status", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "status", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/entities", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "list_entities", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/entities", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "create_entity", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/entities/:entityId", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "get_entity", {
      entityId: req.params.entityId,
      includeRelations: req.query.relations !== "false"
    }, makeCtx(req));
    return res.json(out);
  }));
  app.put("/api/worldmodel/entities/:entityId", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "update_entity", {
      ...req.body,
      entityId: req.params.entityId
    }, makeCtx(req));
    return res.json(out);
  }));
  app.delete("/api/worldmodel/entities/:entityId", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "delete_entity", {
      entityId: req.params.entityId
    }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/relations", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "list_relations", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/relations", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "create_relation", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/simulate", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "simulate", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/simulations", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "list_simulations", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/simulations/:simId", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "get_simulation", {
      simId: req.params.simId
    }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/counterfactual", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "counterfactual", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/snapshot", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "snapshot", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/snapshots", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "list_snapshots", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/extract", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "extract_from_dtu", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/worldmodel/config", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "config", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/worldmodel/config", asyncHandler(async (req, res) => {
    const out = await runMacro("worldmodel", "config", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Semantic Understanding ----
  app.get("/api/semantic/status", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/similar", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "similar", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/embed", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "embed", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/intent", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "classify_intent", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/entities", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "extract_entities", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/roles", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "semantic_roles", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/semantic/compare", asyncHandler(async (req, res) => {
    const out = await runMacro("semantic", "compare", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Transfer Learning ----
  app.get("/api/transfer/status", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/transfer/classify-domain", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "classify_domain", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/transfer/extract-pattern", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "extract_pattern", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/transfer/patterns", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "list_patterns", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/transfer/analogies", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "find_analogies", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/transfer/apply", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "apply_pattern", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/transfer/history", asyncHandler(async (req, res) => {
    const out = await runMacro("transfer", "list_transfers", {}, makeCtx(req));
    return res.json(out);
  }));

  // ---- Experience Learning ----
  app.get("/api/experience/status", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/experience/retrieve", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "retrieve", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/experience/patterns", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "patterns", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/experience/consolidate", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "consolidate", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/experience/strategies", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "strategies", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/experience/recent", asyncHandler(async (req, res) => {
    const out = await runMacro("experience", "recent", req.query, makeCtx(req));
    return res.json(out);
  }));

  // ---- Attention Management ----
  app.get("/api/attention/status", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/attention/thread", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "create_thread", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/attention/thread/complete", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "complete_thread", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/attention/threads", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "list_threads", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/attention/queue", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "queue", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/attention/background", asyncHandler(async (req, res) => {
    const out = await runMacro("attention", "add_background", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Reflection Engine ----
  app.get("/api/reflection/status", asyncHandler(async (req, res) => {
    const out = await runMacro("reflection", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/reflection/recent", asyncHandler(async (req, res) => {
    const out = await runMacro("reflection", "recent", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/reflection/self-model", asyncHandler(async (req, res) => {
    const out = await runMacro("reflection", "self_model", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/reflection/insights", asyncHandler(async (req, res) => {
    const out = await runMacro("reflection", "insights", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/reflection/reflect", asyncHandler(async (req, res) => {
    const out = await runMacro("reflection", "reflect_now", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Commonsense ----
  app.get("/api/commonsense/status", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/commonsense/query", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "query", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/commonsense/facts", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "add_fact", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/commonsense/facts", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "list_facts", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/commonsense/surface/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "surface_assumptions", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/commonsense/assumptions/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("commonsense", "get_assumptions", { dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Grounding ----
  app.get("/api/grounding/status", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/grounding/context", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "context", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/sensors", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "register_sensor", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/grounding/sensors", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "list_sensors", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/readings", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "record_reading", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/grounding/readings", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "recent_readings", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/ground/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "ground_dtu", { ...req.body, dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/calendar/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "link_calendar", { ...req.body, dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/actions", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "propose_action", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/grounding/actions/pending", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "pending_actions", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/grounding/actions/:actionId/approve", asyncHandler(async (req, res) => {
    const out = await runMacro("grounding", "approve_action", { actionId: req.params.actionId }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Reasoning Chains ----
  app.get("/api/reasoning/status", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/reasoning/chains", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "create_chain", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/reasoning/chains", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "list_chains", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/reasoning/chains/:chainId/steps", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "add_step", { ...req.body, chainId: req.params.chainId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/reasoning/chains/:chainId/conclude", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "conclude", { ...req.body, chainId: req.params.chainId }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/reasoning/chains/:chainId/trace", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "get_trace", { chainId: req.params.chainId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/reasoning/steps/:stepId/validate", asyncHandler(async (req, res) => {
    const out = await runMacro("reasoning", "validate_step", { stepId: req.params.stepId }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Inference Engine ----
  app.get("/api/inference/status", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/inference/facts", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "add_fact", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/inference/rules", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "add_rule", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/inference/query", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "query", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/inference/syllogism", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "syllogism", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/inference/forward-chain", asyncHandler(async (req, res) => {
    const out = await runMacro("inference", "forward_chain", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Hypothesis Engine ----
  app.get("/api/hypothesis/status", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/hypothesis", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "propose", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/hypothesis", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "list", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/hypothesis/:hypothesisId", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "get", { hypothesisId: req.params.hypothesisId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/hypothesis/:hypothesisId/experiment", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "design_experiment", { ...req.body, hypothesisId: req.params.hypothesisId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/hypothesis/:hypothesisId/evidence", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "record_evidence", { ...req.body, hypothesisId: req.params.hypothesisId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/hypothesis/:hypothesisId/evaluate", asyncHandler(async (req, res) => {
    const out = await runMacro("hypothesis", "evaluate", { hypothesisId: req.params.hypothesisId }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Metacognition ----
  app.get("/api/metacognition/status", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/assess", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "assess", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/predict", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "predict", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/predictions/:predictionId/resolve", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "resolve_prediction", { ...req.body, predictionId: req.params.predictionId }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metacognition/calibration", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "calibration", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/strategy", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "select_strategy", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metacognition/blindspots", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "blind_spots", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/introspect", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "introspect", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/analyze-failure/:predictionId", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "analyze_failure", { predictionId: req.params.predictionId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/adapt-strategy", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "adapt_strategy", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metacognition/introspection-status", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "introspection_status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metacognition/adjust-confidence", asyncHandler(async (req, res) => {
    const out = await runMacro("metacognition", "adjust_confidence", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Explanation Engine ----
  app.get("/api/explanation/status", asyncHandler(async (req, res) => {
    const out = await runMacro("explanation", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/explanation", asyncHandler(async (req, res) => {
    const out = await runMacro("explanation", "generate", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/explanation/dtu/:dtuId", asyncHandler(async (req, res) => {
    const out = await runMacro("explanation", "explain_dtu", { ...req.body, dtuId: req.params.dtuId }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/explanation/recent", asyncHandler(async (req, res) => {
    const out = await runMacro("explanation", "recent", req.query, makeCtx(req));
    return res.json(out);
  }));

  // ---- Meta-Learning ----
  app.get("/api/metalearning/status", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metalearning/strategies", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "define_strategy", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metalearning/strategies", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "list_strategies", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metalearning/strategies/:strategyId/outcome", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "record_outcome", { ...req.body, strategyId: req.params.strategyId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metalearning/strategies/:strategyId/adapt", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "adapt", { strategyId: req.params.strategyId }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metalearning/strategies/best", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "best_strategy", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/metalearning/curriculum", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "curriculum", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/metalearning/adaptations", asyncHandler(async (req, res) => {
    const out = await runMacro("metalearning", "adaptations", {}, makeCtx(req));
    return res.json(out);
  }));

  // ---- Multimodal + Voice + Tools + Entity ----
  app.post("/api/multimodal/vision", asyncHandler(async (req, res) => {
    const out = await runMacro("multimodal", "vision_analyze", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/multimodal/image-gen", asyncHandler(async (req, res) => {
    const out = await runMacro("multimodal", "image_generate", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/voice/transcribe", asyncHandler(async (req, res) => {
    const out = await runMacro("voice", "transcribe", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/voice/tts", asyncHandler(async (req, res) => {
    const out = await runMacro("voice", "tts", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/tools/web-search", asyncHandler(async (req, res) => {
    const out = await runMacro("tools", "web_search", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/entity/terminal", asyncHandler(async (req, res) => {
    const out = await runMacro("entity", "terminal", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/entity/terminal/approve", asyncHandler(async (req, res) => {
    const out = await runMacro("entity", "terminal_approve", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Sessions ----
  app.get("/api/sessions", (req, res) => {
    const sessions = Array.from(STATE.sessions?.entries?.() || []).map(([id, data]) => ({
      sessionId: id,
      createdAt: data.createdAt,
      messageCount: (data.messages || []).length,
      cloudOptIn: !!data.cloudOptIn,
      lastActivity: (data.messages || [])[data.messages?.length - 1]?.ts || data.createdAt
    }));
    return res.json({ ok: true, sessions });
  });
  app.get("/api/sessions/:id", (req, res) => {
    const session = STATE.sessions.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });
    return res.json({ ok: true, session });
  });
  app.delete("/api/sessions/:id", (req, res) => {
    STATE.sessions.delete(req.params.id);
    STATE.styleVectors.delete(req.params.id);
    saveStateDebounced();
    return res.json({ ok: true, deleted: req.params.id });
  });

  // ---- Search ----
  app.post("/api/search", (req, res) => {
    const query = String(req.body.query || req.body.q || "");
    const topK = clamp(Number(req.body.topK || req.body.k || 10), 1, 100);
    const minScore = clamp(Number(req.body.minScore || 0.08), 0, 1);
    const results = retrieveDTUs(query, { topK, minScore, randomK: 0, oppositeK: 0 });
    return res.json({
      ok: true,
      query,
      results: results.top.map(d => ({
        id: d.id,
        title: d.title,
        tier: d.tier,
        tags: d.tags,
        excerpt: (d.cretiHuman || d.human?.summary || "").slice(0, 200)
      })),
      count: results.top.length
    });
  });

  // ---- Admin ----
  app.get("/api/admin/dashboard", asyncHandler(async (req, res) => {
    const out = await runMacro("admin", "dashboard", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/admin/logs", asyncHandler(async (req, res) => {
    const out = await runMacro("admin", "logs", { limit: req.query.limit, type: req.query.type }, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/admin/metrics", asyncHandler(async (req, res) => {
    const out = await runMacro("admin", "metrics", {}, makeCtx(req));
    return res.json(out);
  }));

  // ---- Plugins ----
  app.get("/api/plugins", asyncHandler(async (req, res) => {
    const out = await runMacro("plugin", "list", {}, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/plugins", asyncHandler(async (req, res) => {
    const out = await runMacro("plugin", "register", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Export/Import ----
  app.post("/api/export/markdown", asyncHandler(async (req, res) => {
    const out = await runMacro("export", "markdown", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/export/obsidian", asyncHandler(async (req, res) => {
    const out = await runMacro("export", "obsidian", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/export/json", asyncHandler(async (req, res) => {
    const out = await runMacro("export", "json", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/import/json", asyncHandler(async (req, res) => {
    const out = await runMacro("import", "json", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/import/markdown", asyncHandler(async (req, res) => {
    const out = await runMacro("import", "markdown", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- LLM local + embed ----
  app.post("/api/llm/local", asyncHandler(async (req, res) => {
    const out = await runMacro("llm", "local", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/llm/embed", asyncHandler(async (req, res) => {
    const out = await runMacro("llm", "embed", req.body, makeCtx(req));
    return res.json(out);
  }));

  // ---- Breakthrough ----
  app.get("/api/breakthrough/status", asyncHandler(async (req, res) => {
    const out = await runMacro("breakthrough", "status", {}, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/breakthrough/clusters", asyncHandler(async (req, res) => {
    const out = await runMacro("breakthrough", "list", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/breakthrough/discover", asyncHandler(async (req, res) => {
    const out = await runMacro("breakthrough", "discover", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.get("/api/breakthrough/clusters/:clusterId", asyncHandler(async (req, res) => {
    const out = await runMacro("breakthrough", "get", { clusterId: req.params.clusterId }, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/breakthrough/clusters/:clusterId/synthesize", asyncHandler(async (req, res) => {
    const out = await runMacro("breakthrough", "synthesize", { ...req.body, clusterId: req.params.clusterId }, makeCtx(req));
    return res.json(out);
  }));

  // ---- Agents (macro-level capability scoring, task routing, swarm status) ----
  app.get("/api/agents/swarm", asyncHandler(async (req, res) => {
    const out = await runMacro("agents", "swarmStatus", req.query, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/agents/evaluate", asyncHandler(async (req, res) => {
    const out = await runMacro("agents", "evaluateCapability", req.body, makeCtx(req));
    return res.json(out);
  }));
  app.post("/api/agents/route", asyncHandler(async (req, res) => {
    const out = await runMacro("agents", "routeTask", req.body, makeCtx(req));
    return res.json(out);
  }));
}
