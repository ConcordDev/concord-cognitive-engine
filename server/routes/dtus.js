/**
 * DTU routes — extracted from server.js
 * Registered directly on app (mixed prefixes)
 */
import path from "path";
import { asyncHandler } from "../lib/async-handler.js";
import { logAudit } from "../lib/audit-logger.js";
import logger from '../logger.js';
import { packDTUContainer, verifyContainerIntegrity } from "../lib/dtu-container.js";

export default function registerDtuRoutes(app, { STATE, makeCtx, runMacro, dtuForClient, dtusArray, userVisibleDTUs, _withAck, _saveStateDebounced, validate }) {

  /** Parse limit/offset query params with sensible defaults and bounds. */
  function parsePagination(query, defaultLimit = 50, maxLimit = 200) {
    const limit = Math.max(1, Math.min(Number(query.limit) || defaultLimit, maxLimit));
    const offset = Math.max(0, Number(query.offset) || 0);
    return { limit, offset };
  }

  // CRETI-first DTU view (no raw JSON by default)
  app.get("/api/dtu_view/:id", (req, res) => {
    const id = req.params.id;
    const d = STATE.dtus.get(id);
    if (!d) return res.status(404).json({ ok:false, error:"DTU not found" });
    return res.json({ ok:true, dtu: dtuForClient(d, { raw: req.query.raw === "1" }) });
  });


  // DTUs
  /** Sanitize macro errors: log full details server-side, return generic message to client. */
  function sanitizeMacroError(e, context) {
    const msg = String(e?.message || e);
    const isForbidden = msg.startsWith("forbidden");
    logger.error("macro_error", { context, error: msg, stack: e?.stack });
    const clientMsg = isForbidden ? "forbidden" : "An internal error occurred";
    return { status: isForbidden ? 403 : 500, clientMsg };
  }

  app.get("/api/dtus", asyncHandler(async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const out = await runMacro("dtu","list",{ q:req.query.q, tier:req.query.tier || "any", limit:req.query.limit, offset:req.query.offset, scope: req.query.scope || null }, ctx);
      res.json(out);
    } catch (e) {
      const { status, clientMsg } = sanitizeMacroError(e, "dtu.list");
      res.status(status).json({ ok: false, error: clientMsg });
    }
  }));
  // ── DTU Stats ─────────────────────────────────────────────────────────
  // Delegates to the dtu.stats macro so the REST endpoint and the
  // macro dispatcher return the exact same shape. Previously this
  // had its own inline computation that could drift from any
  // dtu.stats macro we later added.
  app.get("/api/dtus/stats", async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const result = await runMacro("dtu", "stats", {}, ctx);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Shadow DTU Pending ───────────────────────────────────────────────
  app.get("/api/dtus/shadow/pending", (req, res) => {
    try {
      const shadows = STATE.shadowDtus ? Array.from(STATE.shadowDtus.values()) : [];
      // Candidates: shadow DTUs with enough momentum/richness to potentially promote
      const candidates = shadows
        .filter(d => (d.momentum || 0) > 0 || (d.richness || 0) > 0.3)
        .map(d => ({
          dtuId: d.id,
          title: d.title || d.id,
          momentum: d.momentum || 0,
          richness: d.richness || 0,
          uniqueUsers: d.uniqueUsers || 0,
          interactionCount: d.interactionCount || d.interactions || 0,
        }))
        .sort((a, b) => b.momentum - a.momentum)
        .slice(0, 100);
      // Pending shadows: all shadow DTUs
      const pendingShadows = shadows
        .map(d => ({
          id: d.id,
          title: d.title || d.id,
          tier: d.tier || "shadow",
          kind: d.kind || "unknown",
          richness: d.richness || 0,
          ttlDays: d.ttlDays || 0,
          tags: d.tags || [],
          createdAt: d.createdAt || null,
        }))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 200);
      res.json({ ok: true, candidates, pendingShadows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── DTU Promotion Queue ──────────────────────────────────────────────
  app.get("/api/dtus/promotion/queue", asyncHandler(async (req, res) => {
    try {
      const m = await import("../emergent/promotion-pipeline.js").catch(() => null);
      if (m && typeof m.getQueue === "function") {
        return res.json(m.getQueue());
      }
      // Fallback: derive queue from shadow DTUs with high momentum
      const shadows = STATE.shadowDtus ? Array.from(STATE.shadowDtus.values()) : [];
      const queue = shadows
        .filter(d => (d.momentum || 0) > 0.5 || (d.richness || 0) > 0.6)
        .map(d => ({
          id: d.id,
          artifactName: d.title || d.id,
          fromStage: d.tier || "shadow",
          toStage: "micro",
          status: "pending",
          requestedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
        }))
        .slice(0, 50);
      res.json({ ok: true, queue });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  app.get("/api/dtus/:id", asyncHandler(async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const out = await runMacro("dtu","get",{ id:req.params.id }, ctx);
      if (!out.ok) return res.status(404).json(out);
      res.json(out);
    } catch (e) {
      const { status, clientMsg } = sanitizeMacroError(e, "dtu.get");
      res.status(status).json({ ok: false, error: clientMsg });
    }
  }));
  app.post("/api/dtus", validate("dtuCreate"), asyncHandler(async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const out = await runMacro("dtu","create", req.body || {}, ctx);

      // ── Daily DTU soft cap warning (Category 5: Operational) ──────────
      // Non-blocking: the DTU is still created, but warn the user if they
      // are approaching or exceeding the daily soft cap.
      const DAILY_DTU_SOFT_CAP = 200;
      const userId = ctx?.actor?.id || ctx?.actor?.userId || req.body?.authorId || "anon";
      const todayKey = new Date().toISOString().slice(0, 10);
      if (!STATE._dailyDtuRouteCount) STATE._dailyDtuRouteCount = {};
      if (!STATE._dailyDtuRouteCount[todayKey]) STATE._dailyDtuRouteCount = { [todayKey]: {} };
      if (!STATE._dailyDtuRouteCount[todayKey][userId]) STATE._dailyDtuRouteCount[todayKey][userId] = 0;
      STATE._dailyDtuRouteCount[todayKey][userId]++;
      const dayCount = STATE._dailyDtuRouteCount[todayKey][userId];

      if (out.ok && dayCount > DAILY_DTU_SOFT_CAP) {
        out.warning = `Daily DTU soft cap exceeded: ${dayCount}/${DAILY_DTU_SOFT_CAP} DTUs created today`;
      }

      res.json(out);
    } catch (e) {
      const { status, clientMsg } = sanitizeMacroError(e, "dtu.create");
      res.status(status).json({ ok: false, error: clientMsg });
    }
  }));
  app.post("/api/dtus/saveSuggested", asyncHandler(async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const out = await runMacro("dtu","saveSuggested", req.body || {}, ctx);
      res.json(out);
    } catch (e) {
      const { status, clientMsg } = sanitizeMacroError(e, "dtu.saveSuggested");
      res.status(status).json({ ok: false, error: clientMsg });
    }
  }));

  // DTU maintenance
  app.post("/api/dtus/dedupe", asyncHandler(async (req,res)=> {
    const out = await runMacro("dtu","dedupeSweep", req.body||{}, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus","state","logs"], ["/api/dtus","/api/state/latest","/api/logs"], null, { panel: "dtus_dedupe" }));
  }));
  app.get("/api/megas", (req,res)=> {
    const { limit, offset } = parsePagination(req.query);
    const tier = "mega";
    const all = userVisibleDTUs(req.user?.id || null).filter(d => d.tier===tier).sort((a,b)=> (b.updatedAt||b.createdAt||"").localeCompare(a.updatedAt||a.createdAt||""));
    const out = all.slice(offset, offset + limit);
    res.json({ ok:true, megas: out, total: all.length, limit, offset });
  });
  app.get("/api/hypers", (req,res)=> {
    const { limit, offset } = parsePagination(req.query);
    const all = userVisibleDTUs(req.user?.id || null).filter(d => d.tier==="hyper").sort((a,b)=> (b.updatedAt||b.createdAt||"").localeCompare(a.updatedAt||a.createdAt||""));
    const out = all.slice(offset, offset + limit);
    res.json({ ok:true, hypers: out, total: all.length, limit, offset });
  });

  // Extended DTU endpoints
  app.put("/api/dtus/:id", validate("dtuUpdate"), asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "update", { id: req.params.id, ...req.body }, makeCtx(req));
    return res.json(out);
  }));

  // PATCH is an alias for PUT — frontend client.ts sends PATCH for partial updates
  app.patch("/api/dtus/:id", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "update", { id: req.params.id, ...req.body }, makeCtx(req));
    return res.json(out);
  }));

  app.delete("/api/dtus/:id", asyncHandler(async (req, res) => {
    const ctx = makeCtx(req);
    const out = await runMacro("dtu", "delete", { id: req.params.id }, ctx);

    if (out.ok) {
      const actor = ctx?.actor?.id || ctx?.actor?.userId || req.user?.id || "anon";
      logAudit(actor, "dtu.delete", req.params.id, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }

    return res.json(out);
  }));

  app.post("/api/dtus/cluster", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "cluster", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus"], ["/api/dtus"], null, { panel: "cluster" }));
  }));

  app.post("/api/dtus/reconcile", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "reconcile", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "reconcile" }));
  }));

  app.post("/api/dtus/define", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "define", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus"], ["/api/dtus"], null, { panel: "define" }));
  }));

  app.get("/api/dtus/shadow", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "listShadow", { limit: req.query.limit, q: req.query.q }, makeCtx(req));
    return res.json(out);
  }));

  app.post("/api/dtus/gap-promote", asyncHandler(async (req, res) => {
    const out = await runMacro("dtu", "gapPromote", req.body, makeCtx(req));
    return res.json(_withAck(out, req, ["dtus", "state"], ["/api/dtus", "/api/state/latest"], null, { panel: "gap_promote" }));
  }));

  // Sync a global DTU into the user's local inventory
  app.post("/api/dtus/sync-from-global", asyncHandler(async (req, res) => {
    try {
      const ctx = makeCtx(req);
      const out = await runMacro("dtu", "syncFromGlobal", req.body || {}, ctx);
      if (!out.ok) return res.status(out.error === "Authentication required to sync DTUs" ? 401 : 400).json(out);
      res.json(out);
    } catch (e) {
      const msg = String(e?.message || e);
      res.status(500).json({ ok: false, error: msg });
    }
  }));

  app.get("/api/definitions", (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const all = userVisibleDTUs(req.user?.id || null).filter(d =>
      (d.tags || []).includes("definition") ||
      /^def(inition)?:/i.test(d.title || "")
    );
    const dtus = all.slice(offset, offset + limit);
    return res.json({ ok: true, definitions: dtus, total: all.length, limit, offset });
  });

  app.get("/api/definitions/:term", (req, res) => {
    const term = String(req.params.term || "").toLowerCase();
    const dtu = userVisibleDTUs(req.user?.id || null).find(d =>
      ((d.tags || []).includes("definition") || /^def(inition)?:/i.test(d.title || "")) &&
      (d.meta?.term || "").toLowerCase() === term
    );
    if (!dtu) return res.status(404).json({ ok: false, error: "Definition not found" });
    return res.json({ ok: true, definition: dtu });
  });

  // GET /api/dtu/:id/export — pack a DTU as a portable container archive
  app.get("/api/dtu/:id/export", asyncHandler(async (req, res) => {
    const dtu = dtusArray().find(d => d.id === req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "DTU not found" });
    const artifactRootDir = path.join(process.cwd(), "data", "artifacts");
    const containerPath = await packDTUContainer(dtu, artifactRootDir);
    res.download(containerPath, `dtu-${req.params.id}.tar.gz`, err => {
      if (err) logger.debug("[dtus] export download error", { err: err?.message });
    });
  }));

  // GET /api/dtu/:id/verify-container — verify integrity of a DTU container
  app.get("/api/dtu/:id/verify-container", asyncHandler(async (req, res) => {
    const containerPath = path.join(process.cwd(), "data", "artifacts", `dtu-${req.params.id}.tar.gz`);
    const result = await verifyContainerIntegrity(containerPath);
    res.json({ ok: true, ...result });
  }));
}
