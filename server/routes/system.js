/**
 * System routes — extracted from server.js
 * Covers: health, ready, metrics, status, backup, time, weather, state/latest,
 *         LLM pipeline, quality-pipeline, root, stats, health/capabilities,
 *         health/deep, api/metrics (chicken2), DTU paginated, openapi, docs,
 *         search/indexed, search/dsl, search/reindex, global/search
 */
import { asyncHandler } from "../lib/async-handler.js";
import { validateBody, llmGenerateSchema } from "../lib/validators/mutation-schemas.js";
import logger from '../logger.js';
import { assertSessionAccessible } from "../lib/session-access.js";

export default function registerSystemRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  requireRole,
  db,
  MACROS,
  VERSION,
  PORT,
  NODE_ENV,
  LLM_READY,
  LLM_MODEL_FAST,
  LLM_MODEL_SMART,
  SEED_INFO,
  STATE_DISK,
  USE_SQLITE_STATE,
  ENV_VALIDATION,
  AUTH_MODE,
  CAPS,
  METRICS,
  JWT_SECRET,
  AUTH_USES_JWT,
  AUTH_USES_APIKEY,
  AuthDB,
  rateLimiter,
  helmet,
  normalizeText,
  nowISO,
  clamp,
  dtusArray, userVisibleDTUs,
  isShadowDTU,
  _saveStateDebounced,
  listDomains,
  getLLMPipelineStatus,
  setLLMPipelineMode,
  llmPipeline,
  getTimeInfo,
  getWeather,
  createBackup,
  listBackups,
  restoreBackup,
  ensureOrganRegistry,
  ensureQueues,
  _getPatternHistory,
  classifyDomain,
  _inferQueryIntent,
  CRETI_PROJECTION_RULES,
  searchIndexed,
  paginateResults,
  _auditLog,
  AUDIT_LOG,
  computeSubstrateStats,
  getDbStatus,
}) {

  // ---- Root ----
  app.get("/", (req, res) => res.json({ ok:true, name:"Concord v2 Macro\u2011Max", version: VERSION }));

  // ---- robots.txt ----
  // Public knowledge (DTUs, lenses, search) is open \u2014 let AI crawlers index it.
  // Personal user data paths are blocked for all bots.
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send([
      "User-agent: *",
      "Crawl-delay: 5",
      "# Personal data \u2014 never crawl",
      "Disallow: /api/auth/",
      "Disallow: /api/admin/",
      "Disallow: /api/personal-locker/",
      "Disallow: /api/initiative/settings",
      "Disallow: /api/initiative/history",
      "Disallow: /api/initiative/pending",
      "Disallow: /api/learning/earnings/",
      "Disallow: /api/learning/submissions/",
      "Disallow: /api/learning/cohort/mine",
      "Disallow: /api/learning/credential/me/",
      "Disallow: /api/economy/wallet/",
      "Disallow: /api/wagers/",
      "Disallow: /api/channels/settings",
      "# Public knowledge is welcome",
      "Allow: /api/dtus",
      "Allow: /api/search",
      "Allow: /api/lenses",
      "Allow: /api/knowledge",
      "Allow: /api/learning/",
      "",
    ].join("\n"));
  });

  // ---- Health & Readiness ----
  app.get("/health", (req, res) => {
    const checks = { server: true };
    let healthy = true;
    if (db) {
      try {
        const row = db.prepare("SELECT 1 AS ok").get();
        checks.database = Boolean(row?.ok);
      } catch {
        checks.database = false;
        healthy = false;
      }
    } else {
      checks.database = "no_db";
    }
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1048576);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1048576);
    checks.memoryMB = { used: heapUsedMB, total: heapTotalMB };
    if (heapUsedMB > 1700) {
      checks.memoryPressure = true;
      healthy = false;
    }
    const dbStatus = typeof getDbStatus === 'function' ? getDbStatus() : {};
    checks.postgres = { connected: !!dbStatus.pgPool, status: dbStatus.pgPool ? 'connected' : 'in-memory-fallback' };
    checks.redis = { connected: !!dbStatus.redisClient, status: dbStatus.redisClient ? 'connected' : 'in-memory-fallback' };
    checks.saveFailures = STATE._saveFailures || 0;

    // Per-brain LLM availability — surfaces Ollama reachability so an
    // operator hitting /health sees at a glance which models are online
    // without a separate /api/brain/health round-trip. The `enabled`
    // flag is maintained by initFiveBrains() probe + /api/brain/health
    // recovery loop. We do NOT mark `healthy=false` if a brain is down;
    // brains have deterministic fallbacks and a missing brain shouldn't
    // page the on-call. Synthetic monitoring should alert on the brain-
    // specific endpoint instead.
    const BRAIN = globalThis._concordBRAIN;
    if (BRAIN && typeof BRAIN === 'object') {
      const brains = {};
      for (const [name, brain] of Object.entries(BRAIN)) {
        if (!brain || typeof brain !== 'object') continue;
        brains[name] = {
          enabled: !!brain.enabled,
          model: brain.model || null,
          url: brain.url || null,
        };
      }
      checks.brains = brains;
    }

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      version: VERSION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks
    });
  });

  app.get("/ready", (req, res) => {
    const checks = {
      state: STATE.dtus !== null,
      macros: MACROS.size > 0
    };
    if (db) {
      try {
        db.prepare("SELECT 1").get();
        checks.database = true;
      } catch {
        checks.database = false;
      }
    }
    const ready = Object.values(checks).every(v => v === true || v === "no_db");
    res.status(ready ? 200 : 503).json({
      ready,
      checks,
      version: VERSION
    });
  });

  // ---- Structured health sub-endpoints ----

  // Alias /api/health → /health for monitoring tools expecting /api/ prefix
  app.get("/api/health", (req, res) => res.redirect(307, "/health"));

  app.get("/api/health/db", (req, res) => {
    const checks = {};
    let status = "healthy";
    if (db) {
      try {
        const row = db.prepare("SELECT 1 AS ok").get();
        checks.sqlite = { status: row?.ok ? "healthy" : "unhealthy", connected: Boolean(row?.ok) };
        if (!row?.ok) status = "unhealthy";
      } catch (e) {
        checks.sqlite = { status: "unhealthy", connected: false, error: e.message };
        status = "unhealthy";
      }
    } else {
      checks.sqlite = { status: "healthy", connected: false, note: "in-memory-mode" };
    }
    const dbStatus = typeof getDbStatus === "function" ? getDbStatus() : {};
    checks.postgres = { status: dbStatus.pgPool ? "healthy" : "not_configured", connected: !!dbStatus.pgPool };
    checks.redis = { status: dbStatus.redisClient ? "healthy" : "not_configured", connected: !!dbStatus.redisClient };
    res.status(status === "healthy" ? 200 : 503).json({ status, checks });
  });

  app.get("/api/health/ws", (req, res) => {
    const REALTIME = globalThis._concordREALTIME || {};
    const clientCount = REALTIME.clients?.size ?? REALTIME.io?.sockets?.size ?? 0;
    const ready = REALTIME.ready === true;
    res.status(ready ? 200 : 503).json({
      status: ready ? "healthy" : "degraded",
      details: { ready, connectedClients: clientCount },
    });
  });

  app.get("/api/health/brain", (req, res) => res.redirect(307, "/api/brain/health"));

  app.get("/metrics", asyncHandler(async (req, res) => {
    // Prometheus-compatible plain text metrics for Concord system
    const lines = [];
    try {
      // Entity metrics
      const emergents = STATE.__emergent?.emergents;
      const activeCount = emergents ? Array.from(emergents.values()).filter(e => e.active).length : 0;
      const inactiveCount = emergents ? emergents.size - activeCount : 0;
      lines.push(`# HELP concord_entities_total Total number of entities`);
      lines.push(`# TYPE concord_entities_total gauge`);
      lines.push(`concord_entities_total{status="active"} ${activeCount}`);
      lines.push(`concord_entities_total{status="inactive"} ${inactiveCount}`);

      // DTU metrics
      const dtuCount = STATE.dtus?.size || 0;
      const shadowCount = STATE.shadowDtus?.size || 0;
      lines.push(`# HELP concord_dtus_total Total number of DTUs`);
      lines.push(`# TYPE concord_dtus_total gauge`);
      lines.push(`concord_dtus_total{scope="all"} ${dtuCount}`);
      lines.push(`concord_dtus_total{scope="shadow"} ${shadowCount}`);

      // Brain metrics
      const BRAIN = globalThis._concordBRAIN;
      if (BRAIN) {
        lines.push(`# HELP concord_brain_requests_total Total brain requests`);
        lines.push(`# TYPE concord_brain_requests_total counter`);
        lines.push(`# HELP concord_brain_errors_total Total brain errors`);
        lines.push(`# TYPE concord_brain_errors_total counter`);
        lines.push(`# HELP concord_brain_avg_latency_ms Average brain latency`);
        lines.push(`# TYPE concord_brain_avg_latency_ms gauge`);
        lines.push(`# HELP concord_brain_enabled Brain enabled status`);
        lines.push(`# TYPE concord_brain_enabled gauge`);
        for (const [name, brain] of Object.entries(BRAIN)) {
          lines.push(`concord_brain_requests_total{brain="${name}"} ${brain.stats?.requests || 0}`);
          lines.push(`concord_brain_errors_total{brain="${name}"} ${brain.stats?.errors || 0}`);
          const avgMs = brain.stats?.requests > 0 ? Math.round(brain.stats.totalMs / brain.stats.requests) : 0;
          lines.push(`concord_brain_avg_latency_ms{brain="${name}"} ${avgMs}`);
          lines.push(`concord_brain_enabled{brain="${name}"} ${brain.enabled ? 1 : 0}`);
        }
      }

      // Heartbeat metrics
      const tickCount = STATE.__bgTickCounter || 0;
      lines.push(`# HELP concord_heartbeat_tick_total Total heartbeat ticks`);
      lines.push(`# TYPE concord_heartbeat_tick_total counter`);
      lines.push(`concord_heartbeat_tick_total ${tickCount}`);

      // Session metrics
      lines.push(`# HELP concord_sessions_total Total active sessions`);
      lines.push(`# TYPE concord_sessions_total gauge`);
      lines.push(`concord_sessions_total ${STATE.sessions?.size || 0}`);

      // Process metrics
      const mem = process.memoryUsage();
      lines.push(`# HELP concord_process_memory_bytes Process memory usage`);
      lines.push(`# TYPE concord_process_memory_bytes gauge`);
      lines.push(`concord_process_memory_bytes{type="rss"} ${mem.rss}`);
      lines.push(`concord_process_memory_bytes{type="heapUsed"} ${mem.heapUsed}`);
      lines.push(`concord_process_memory_bytes{type="heapTotal"} ${mem.heapTotal}`);

      lines.push(`# HELP concord_uptime_seconds Process uptime`);
      lines.push(`# TYPE concord_uptime_seconds gauge`);
      lines.push(`concord_uptime_seconds ${Math.round(process.uptime())}`);
    } catch (e) {
      lines.push(`# Error collecting metrics: ${e.message}`);
    }

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  }));

  // ---- Backup ----
  app.post("/api/backup", requireRole("owner", "admin"), asyncHandler(async (req, res) => {
    const name = req.body?.name || "";
    const result = await createBackup(name);
    res.json(result);
  }));
  app.get("/api/backups", requireRole("owner", "admin"), (req, res) => {
    res.json(listBackups());
  });
  app.post("/api/backup/restore", requireRole("owner"), asyncHandler(async (req, res) => {
    const target = req.body?.path || req.body?.name || "";
    const result = await restoreBackup(target);
    res.json(result);
  }));

  // ---- Status ----
  app.get("/api/status", (req, res) => {
    const base = {
      ok: true,
      version: VERSION,
      nodeEnv: NODE_ENV,
      uptime: process.uptime(),
      llmReady: LLM_READY,
      counts: {
        dtus: STATE.dtus?.size || 0,
        wrappers: STATE.wrappers?.size || 0,
        layers: STATE.layers?.size || 0,
        personas: STATE.personas?.length || STATE.personas?.size || 0,
        events: AUDIT_LOG?.length || 0,
        emergents: STATE.__emergent?.emergents?.size || 0,
      },
      llm: {
        enabled: LLM_READY,
      },
      sims: STATE.lastSim ? 1 : 0,
    };
    const isAuthed = req.user || req.apiKeyUser;
    if (isAuthed) {
      Object.assign(base, {
        port: PORT,
        llmModel: { fast: LLM_MODEL_FAST, smart: LLM_MODEL_SMART },
        macroDomains: listDomains(),
        crawlQueue: STATE.crawlQueue?.length || 0,
        settings: STATE.settings,
        seed: SEED_INFO,
        stateDisk: STATE_DISK,
        infrastructure: {
          database: { type: db ? "sqlite" : "json", ready: Boolean(db) },
          stateBackend: { type: USE_SQLITE_STATE ? "sqlite" : "json" },
          auth: {
            mode: AUTH_MODE,
            totalUsers: AuthDB.getUserCount(),
            jwtConfigured: Boolean(JWT_SECRET),
            usesJwt: AUTH_USES_JWT,
            usesApiKey: AUTH_USES_APIKEY
          },
          security: {
            csrfEnabled: NODE_ENV === "production",
            rateLimitEnabled: Boolean(rateLimiter),
            helmetEnabled: Boolean(helmet)
          },
          envValidation: ENV_VALIDATION,
          llmPipeline: getLLMPipelineStatus(),
          capabilities: CAPS
        }
      });
    }
    res.json(base);
  });

  // ---- LLM Pipeline API ----
  app.get("/api/llm/status", (req, res) => {
    res.json({ ok: true, ...getLLMPipelineStatus() });
  });
  app.post("/api/llm/generate", validateBody(llmGenerateSchema), asyncHandler(async (req, res) => {
    const { prompt, mode, temperature, maxTokens } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "prompt required" });
    }
    const result = await llmPipeline(prompt, { mode, temperature, maxTokens });
    res.json(result);
  }));
  app.post("/api/llm/mode", requireRole("owner", "admin"), (req, res) => {
    const { mode } = req.body || {};
    const result = setLLMPipelineMode(mode);
    res.json(result);
  });

  // ---- Quality Pipeline ----
  app.get("/api/quality-pipeline/status", (req, res) => {
    const sessionId = req.query.sessionId || "";
    const shadowCount = STATE.shadowDtus ? STATE.shadowDtus.size : 0;
    const patternShadows = Array.from(STATE.shadowDtus?.values() || []).filter(s => s?.machine?.kind === "pattern_shadow").length;
    const history = sessionId ? _getPatternHistory(sessionId) : [];
    res.json({
      ok: true,
      pipeline: {
        version: "1.0.0",
        patterns: {
          P1: { name: "Shadow DTU Distillation", alwaysRun: false, condition: "shadow DTU matches exist" },
          P2: { name: "CRETI Projection", alwaysRun: true, condition: "always" },
          P3: { name: "Linguistic Spine Rewrite", alwaysRun: false, condition: "non-default style/affect" },
          P4: { name: "Multi-Lens Convergence", alwaysRun: false, condition: "multi-domain query" },
          P5: { name: "Contradiction Pre-Resolution", alwaysRun: false, condition: "conflict detected in set" },
          P6: { name: "Resonance-Weighted Micro-Prompt", alwaysRun: true, condition: "always" }
        },
        shadowDtus: { total: shadowCount, patternShadows },
        sessionHistory: history,
        maxConcurrent: 3,
        backendEnhancements: ["coherenceAudit", "shadowPromotion", "crispnessDecay"]
      }
    });
  });

  app.post("/api/quality-pipeline/preview", (req, res) => {
    try {
      const { query, sessionId, mode } = req.body || {};
      if (!query) return res.json({ ok: false, error: "Missing query" });
      const sid = sessionId || "preview";
      const pseudoDtu = { title: String(query).slice(0, 100), human: { summary: String(query).slice(0, 300) }, tags: [] };
      const domain = classifyDomain(pseudoDtu);
      const intent = _inferQueryIntent(query, mode || "explore");
      const history = _getPatternHistory(sid);
      res.json({
        ok: true,
        preview: {
          queryIntent: intent,
          domain,
          recentPatterns: history,
          projectionRules: CRETI_PROJECTION_RULES[intent] || CRETI_PROJECTION_RULES.default
        }
      });
    } catch (e) {
      res.json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- Time (authoritative; never uses LLM) ----
  app.get("/api/time", (req, res) => {
    try {
      const tz = String(req.query.tz || "America/New_York");
      return res.json({ ok:true, ...getTimeInfo(tz) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // ---- Weather (authoritative; cached; never uses LLM) ----
  app.get("/api/weather", asyncHandler(async (req, res) => {
    try {
      const location = String(req.query.location || req.query.q || "Poughkeepsie, NY");
      const tz = String(req.query.tz || "America/New_York");
      const out = await getWeather(location, { timeZone: tz });
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  }));

  // ---- State Snapshot ----
  app.get("/api/state/latest", (req, res) => {
    try {
      const sessionId = normalizeText(req.query.sessionId || "default");
      const sess = STATE.sessions.get(sessionId) || { createdAt: null, messages: [] };
      // Owner gate — refuse cross-user reads of session message history.
      // Pre-fix this leaked the last 20 messages of any session to any
      // unauthed caller who could guess the sessionId. The "default"
      // sessionId is treated as a public placeholder (no ownerId) and
      // stays accessible — it's never a real user session.
      const callerUserId = req.user?.id || req.actor?.userId || null;
      if (sess.ownerId && !assertSessionAccessible(sess, callerUserId)) {
        return res.status(403).json({ ok: false, error: "session_forbidden" });
      }
      const lastMessages = (sess.messages || []).slice(-20);
      const latestDTUs = userVisibleDTUs().slice(0, 10).map(d => ({
        id: d.id,
        title: d.title,
        tier: d.tier,
        tags: d.tags || [],
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      }));
      res.json({
        ok: true,
        sessionId,
        session: { createdAt: sess.createdAt || null, turns: lastMessages.length },
        lastMessages,
        latestDTUs,
        lastSim: STATE.lastSim || null,
        settings: STATE.settings
      });
    } catch (e) {
      res.json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- Chicken2 Metrics ----
  app.get("/api/metrics", (req, res) => {
    ensureOrganRegistry();
    ensureQueues();
    const c2 = STATE.__chicken2 || {};
    res.json({ ok:true, metrics: c2.metrics, lastProof: c2.lastProof, recentLogs: (c2.logs||[]).slice(-50) });
  });

  // ---- Health Capabilities ----
  app.get("/api/health/capabilities", (req, res) => {
    ensureOrganRegistry();
    ensureQueues();
    const cap = {
      version: VERSION,
      llmReady: LLM_READY,
      dtus: STATE.dtus?.size || 0,
      wrappers: STATE.wrappers?.size || 0,
      layers: STATE.layers?.size || 0,
      personas: STATE.personas?.size || 0,
      sessions: STATE.sessions?.size || 0,
      organs: STATE.organs?.size || 0,
      growth: STATE.growth || {},
      abstraction: STATE.abstraction || {},
    };
    res.json({ ok:true, capabilities: cap });
  });

  // ---- Stats (restructured: public count = knowledge + seed + mega + hyper) ----
  app.get("/api/stats", (req, res) => {
    // Use classification-based substrate stats if available
    let substrateStats = null;
    try {
      if (typeof computeSubstrateStats === "function") {
        substrateStats = computeSubstrateStats(STATE.dtus, STATE.shadowDtus);
      }
    } catch (_e) { logger.debug('system', 'fallback below', { error: _e?.message }); }

    const stats = {
      dtus: substrateStats ? {
        // Public count: only genuine knowledge DTUs
        total: substrateStats.substrate.knowledge.total,
        byTier: {
          regular: substrateStats.substrate.knowledge.regular,
          seed: substrateStats.substrate.knowledge.seed,
          mega: substrateStats.substrate.knowledge.mega,
          hyper: substrateStats.substrate.knowledge.hyper,
        },
        // Internal infrastructure (separate section)
        internal: substrateStats.substrate.internal,
        grand_total: substrateStats.substrate.grand_total,
      } : {
        // Legacy fallback
        total: STATE.dtus?.size || 0,
        byTier: {
          regular: userVisibleDTUs().filter(d => d.tier === "regular").length,
          mega: userVisibleDTUs().filter(d => d.tier === "mega").length,
          hyper: userVisibleDTUs().filter(d => d.tier === "hyper").length,
          shadow: STATE.shadowDtus?.size || 0
        }
      },
      sessions: {
        total: STATE.sessions?.size || 0,
        active: Array.from(STATE.sessions?.values?.() || []).filter(s => {
          const last = (s.messages || [])[s.messages?.length - 1];
          return last && (Date.now() - new Date(last.ts).getTime()) < 3600000;
        }).length
      },
      organs: {
        total: STATE.organs?.size || 0,
        healthy: Array.from(STATE.organs?.values?.() || []).filter(o => o.status === "alive").length
      },
      growth: STATE.growth || {},
      abstraction: {
        enabled: STATE.abstraction?.enabled ?? false,
        metrics: STATE.abstraction?.metrics || {},
        ledger: STATE.abstraction?.ledger || {}
      },
      queues: Object.fromEntries(
        Object.entries(STATE.queues || {}).map(([k, v]) => [k, v.length])
      ),
      jobs: {
        total: STATE.jobs?.size || 0,
        queued: Array.from(STATE.jobs?.values?.() || []).filter(j => j.status === "queued").length,
        running: Array.from(STATE.jobs?.values?.() || []).filter(j => j.status === "running").length,
        succeeded: Array.from(STATE.jobs?.values?.() || []).filter(j => j.status === "succeeded").length,
        failed: Array.from(STATE.jobs?.values?.() || []).filter(j => j.status === "failed").length
      }
    };
    return res.json({ ok: true, stats });
  });

  // ---- Health API ----
  app.get("/api/health", (req, res) => {
    const dbStatus = typeof getDbStatus === 'function' ? getDbStatus() : {};
    const health = {
      status: "healthy",
      version: VERSION,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: nowISO(),
      checks: {
        state: STATE ? "ok" : "error",
        dtus: (STATE.dtus?.size || 0) > 0 ? "ok" : "warning",
        llm: LLM_READY ? "ok" : "disabled",
        organs: (STATE.organs?.size || 0) > 0 ? "ok" : "warning",
        growth: STATE.growth ? "ok" : "warning"
      },
      postgres: { connected: !!dbStatus.pgPool, status: dbStatus.pgPool ? 'connected' : 'in-memory-fallback' },
      redis: { connected: !!dbStatus.redisClient, status: dbStatus.redisClient ? 'connected' : 'in-memory-fallback' },
      saveFailures: STATE._saveFailures || 0,
    };
    const hasErrors = Object.values(health.checks).some(v => v === "error");
    health.status = hasErrors ? "unhealthy" : "healthy";
    return res.status(hasErrors ? 503 : 200).json(health);
  });

  app.get("/api/health/deep", (req, res) => {
    const checks = [];
    checks.push({
      name: "state_integrity",
      status: STATE && typeof STATE === "object" ? "pass" : "fail",
      details: { hasState: !!STATE }
    });
    const allPassed = checks.every(c => c.status === "pass");
    return res.status(allPassed ? 200 : 503).json({
      ok: allPassed,
      status: allPassed ? "healthy" : "unhealthy",
      checks,
      timestamp: nowISO()
    });
  });

  // ---- DTU Paginated ----
  app.get("/api/dtus/paginated", (req, res) => {
    const page = clamp(Number(req.query.page || 1), 1, 10000);
    const pageSize = clamp(Number(req.query.pageSize || 20), 1, 100);
    const tier = req.query.tier || null;
    const tag = req.query.tag || null;
    const scopeFilter = req.query.scope || null;
    const userId = req.user?.id || null;

    let dtus = userVisibleDTUs();

    // Scope-aware filtering: same logic as dtu.list macro
    if (scopeFilter === "global") {
      dtus = dtus.filter(d => d.scope === "global");
    } else if (scopeFilter === "local") {
      dtus = dtus.filter(d => d.scope !== "global" && (!userId || !d.ownerId || d.ownerId === userId));
    } else if (userId) {
      // Default view: user's own local/personal DTUs + all global DTUs
      dtus = dtus.filter(d => d.scope === "global" || !d.ownerId || d.ownerId === userId);
    } else {
      // Anonymous: only global DTUs
      dtus = dtus.filter(d => !d.scope || d.scope === "global");
    }

    if (tier) dtus = dtus.filter(d => d.tier === tier);
    if (tag) dtus = dtus.filter(d => (d.tags || []).includes(tag));
    const result = paginateResults(dtus, { page, pageSize });
    return res.json({ ok: true, ...result });
  });

  // ---- Search (indexed, DSL, reindex, global) ----
  app.get("/api/search/indexed", (req, res) => {
    const q = String(req.query.q || "");
    const limit = clamp(Number(req.query.limit || 20), 1, 100);
    const results = searchIndexed(q, { limit });
    return res.json({ ok: true, query: q, results, count: results.length });
  });

  app.get("/api/search/dsl", asyncHandler(async (req, res) => {
    const out = await runMacro("search", "query", { q: req.query.q, limit: req.query.limit }, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/search/reindex", asyncHandler(async (req, res) => {
    const out = await runMacro("search", "reindex", {}, makeCtx(req));
    return res.json(out);
  }));

  app.get("/api/global/search", (req, res) => {
    const query = String(req.query.q || "").trim();
    const scope = String(req.query.scope || "all");
    const limit = clamp(Number(req.query.limit || 20), 1, 100);
    if (!query) return res.json({ ok: true, results: [], query: "", count: 0 });
    const results = [];
    if (scope === "all" || scope === "dtus") {
      const indexed = searchIndexed(query, { limit, minScore: 0.01 });
      for (const dtu of indexed) {
        results.push({
          id: dtu.id,
          type: "dtu",
          title: dtu.title || "Untitled",
          excerpt: dtu.human?.summary || dtu.cretiHuman || (dtu.core?.definitions || []).slice(0, 1).join("") || "",
          tier: dtu.tier || "regular",
          tags: (dtu.tags || []).slice(0, 5),
          createdAt: dtu.createdAt,
          score: dtu._searchScore || 0
        });
      }
    }
    if (scope === "all" || scope === "tags") {
      const qLower = query.toLowerCase();
      const tagCounts = new Map();
      for (const dtu of userVisibleDTUs()) {
        if (isShadowDTU(dtu)) continue;
        for (const tag of (dtu.tags || [])) {
          if (tag.toLowerCase().includes(qLower)) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }
      const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [tag, count] of sortedTags) {
        results.push({
          id: `tag:${tag}`,
          type: "tag",
          title: tag,
          excerpt: `${count} DTU${count !== 1 ? "s" : ""} tagged`,
          score: count / 100
        });
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return res.json({ ok: true, results: results.slice(0, limit), query, count: results.length });
  });
}
