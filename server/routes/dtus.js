/**
 * DTU routes — extracted from server.js
 * Registered directly on app (mixed prefixes)
 */
import path from "path";
import { asyncHandler } from "../lib/async-handler.js";
import {
  encodeDTU, decodeDTU, verifyDTU, determinePrimaryType,
} from "../economy/dtu-format.js";
import { DTU_FORMAT_CONSTANTS } from "../lib/dtu-format-constants.js";
import { randomUUID } from "crypto";

export default function registerDtuRoutes(app, { STATE, makeCtx, runMacro, dtuForClient, dtusArray, _withAck, _saveStateDebounced, validate }) {

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
      const body = req.body || {};

      // v2.0 recipe substrate: validate the new recipe DTU types and
      // default their scope to 'personal' so the sovereignty invariant
      // (`personal_dtus_never_leak`) protects them automatically. Users can
      // explicitly publish via POST /api/personal-locker/dtus/:id/list-on-marketplace.
      const metaType = body?.meta?.type;
      if (metaType) {
        const recipeCheck = validateRecipeByType(metaType, body?.meta || {});
        if (!recipeCheck.ok) {
          return res.status(400).json({ ok: false, error: `recipe_invalid:${recipeCheck.error}` });
        }
        if (PERSONAL_DEFAULT_RECIPE_TYPES.has(metaType) && !body.scope) {
          body.scope = "personal";
        }
      }

      const out = await runMacro("dtu","create", body, ctx);

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

  // GET /api/dtus/:id/lineage — return full lineage tree with forks, citations, and royalty info
  app.get("/api/dtus/:id/lineage", (req, res) => {
    const id = req.params.id;
    const dtu = STATE.dtus.get(id);
    if (!dtu) return res.status(404).json({ ok: false, error: "DTU not found" });

    const parentIds = dtu.lineage?.parents || dtu.parents || [];
    const childIds = dtu.lineage?.children || dtu.children || [];
    const citationIds = dtu.meta?.citations || dtu.citations || [];
    const relatedIds = dtu.relatedIds || [];

    // Resolve a list of IDs into enriched objects with royalty info
    const resolve = (ids) => (Array.isArray(ids) ? ids : []).map(pid => {
      const p = STATE.dtus.get(pid);
      return p
        ? {
            id: pid,
            title: p.title || p.human?.summary || pid,
            summary: p.human?.summary || p.summary,
            tier: p.tier || 'regular',
            type: p.type || p.meta?.type || 'original',
            ownerId: p.ownerId || p.creatorId,
            domain: p.domain,
            timestamp: p.timestamp || p.createdAt,
          }
        : { id: pid, title: pid };
    });

    // Separate children into forks and regular children
    const allChildren = resolve(childIds);
    const forks = allChildren.filter(c => c.type === 'fork' || c.type === 'derivative');
    const regularChildren = allChildren.filter(c => c.type !== 'fork' && c.type !== 'derivative');

    // Find DTUs that cite this one (reverse citation lookup)
    const citedBy = [];
    for (const [otherId, otherDtu] of STATE.dtus) {
      if (otherId === id) continue;
      const otherCitations = otherDtu.meta?.citations || otherDtu.citations || [];
      const otherParents = otherDtu.lineage?.parents || otherDtu.parents || [];
      if ((Array.isArray(otherCitations) && otherCitations.includes(id)) ||
          (Array.isArray(otherParents) && otherParents.includes(id))) {
        const resolved = STATE.dtus.get(otherId);
        citedBy.push({
          id: otherId,
          title: resolved?.title || resolved?.human?.summary || otherId,
          summary: resolved?.human?.summary || resolved?.summary,
          tier: resolved?.tier || 'regular',
          ownerId: resolved?.ownerId || resolved?.creatorId,
        });
      }
      if (citedBy.length >= 50) break; // cap for performance
    }

    // Build royalty cascade preview — shows how royalties would flow from this DTU
    const royaltyCascade = [];
    const INITIAL_RATE = 0.21;
    const ROYALTY_FLOOR = 0.0005;
    const ancestors = resolve(parentIds);
    ancestors.forEach((ancestor, i) => {
      const rate = Math.max(INITIAL_RATE / Math.pow(2, i + 1), ROYALTY_FLOOR);
      royaltyCascade.push({
        id: ancestor.id,
        title: ancestor.title,
        ownerId: ancestor.ownerId,
        generation: i + 1,
        royaltyRate: rate,
        royaltyPercent: (rate * 100).toFixed(2) + '%',
      });
    });

    return res.json({
      ok: true,
      dtuId: id,
      current: {
        id,
        title: dtu.title || dtu.human?.summary || id,
        tier: dtu.tier || 'regular',
        type: dtu.type || dtu.meta?.type || 'original',
        ownerId: dtu.ownerId || dtu.creatorId,
        domain: dtu.domain,
      },
      parents: ancestors,
      children: regularChildren,
      forks,
      citations: resolve(citationIds),
      citedBy,
      relatedIds: relatedIds.slice(0, 20),
      royaltyCascade,
    });
  });

  // GET /api/dtus/stats — return DTU tier counts and compression ratio
  app.get("/api/dtus/stats", (req, res) => {
    let totalCount = 0;
    let shadowCount = 0;
    let regularCount = 0;
    let megaCount = 0;
    let hyperCount = 0;
    let archivedCount = 0;

    for (const d of STATE.dtus.values()) {
      totalCount++;
      const tier = (d.tier || 'regular').toString().toLowerCase();
      const status = (d.status || d.meta?.status || 'active').toString().toLowerCase();
      const isShadow = tier === 'shadow' || (Array.isArray(d.tags) && d.tags.includes('shadow'));

      if (status === 'archived' || status === 'merged' || status === 'inactive') {
        archivedCount++;
      } else if (isShadow) {
        shadowCount++;
      } else if (tier === 'mega') {
        megaCount++;
      } else if (tier === 'hyper') {
        hyperCount++;
      } else {
        regularCount++;
      }
    }

    const activeInMemory = totalCount - archivedCount;
    const compressionRatio = activeInMemory > 0
      ? Math.round((totalCount / activeInMemory) * 100) / 100
      : 1;

    return res.json({
      ok: true,
      totalCount,
      shadowCount,
      regularCount,
      megaCount,
      hyperCount,
      archivedCount,
      compressionRatio,
    });
  });

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

  // ── .dtu File Format Export ─────────────────────────────────────────
  // GET /api/dtus/:id/export.dtu — Package DTU into binary .dtu format
  app.get("/api/dtus/:id/export.dtu", asyncHandler(async (req, res) => {
    const id = req.params.id;
    const dtu = STATE.dtus.get(id);
    if (!dtu) return res.status(404).json({ ok: false, error: "DTU not found" });

    // Determine format type from tier
    const C = DTU_FORMAT_CONSTANTS;
    const formatType = dtu.tier === "hyper" ? C.TYPE_HYPER
      : dtu.tier === "mega" ? C.TYPE_MEGA
      : C.TYPE_DTU;

    // Build layers from DTU data
    const humanLayer = {
      title: dtu.title || dtu.human?.title || "",
      summary: dtu.summary || dtu.human?.summary || "",
      content: dtu.content || dtu.human?.content || "",
      tags: dtu.tags || [],
    };

    const coreLayer = dtu.core || {
      id: dtu.id,
      tier: dtu.tier,
      domain: dtu.domain,
      source: dtu.source,
      resonance: dtu.resonance,
      coherence: dtu.coherence,
      stability: dtu.stability,
      parents: dtu.parents || [],
      children: dtu.children || [],
    };

    const machineLayer = dtu.machine || {
      embedding: dtu.embedding ? "[redacted]" : null,
      integrityStatus: dtu.meta?.integrityStatus,
      contentHash: dtu.meta?.contentHash,
    };

    // Resolve artifact data if present
    let artifactData = null;
    let artifactMimeType = null;
    if (dtu.artifactRef || dtu.meta?.artifactId) {
      const mediaId = dtu.artifactRef || dtu.meta?.artifactId;
      const mediaDtu = STATE.dtus.get(mediaId) || (STATE._media && STATE._media.items?.get(mediaId));
      if (mediaDtu) {
        artifactMimeType = mediaDtu.mimeType || mediaDtu.meta?.mimeType || "";
      }
    }

    const result = encodeDTU({
      id: dtu.id,
      creatorId: dtu.ownerId || dtu.creatorId,
      createdAt: dtu.timestamp || dtu.createdAt,
      lineage: { parents: dtu.parents || [], children: dtu.children || [] },
      humanLayer,
      coreLayer,
      machineLayer,
      artifactData,
      artifactMimeType,
      artifactType: dtu.meta?.artifactType || null,
      contentType: dtu.primaryType || dtu.meta?.primaryType || null,
      formatType,
    });

    if (!result.ok) {
      return res.status(500).json({ ok: false, error: "encode_failed", detail: result.error });
    }

    // Determine file extension based on tier
    const ext = dtu.tier === "hyper" ? ".hyper.dtu"
      : dtu.tier === "mega" ? ".mega.dtu"
      : ".dtu";
    const filename = `${(dtu.title || dtu.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)}${ext}`;

    res.set({
      "Content-Type": "application/vnd.concord.dtu",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": result.buffer.length,
      "X-DTU-Content-Hash": result.contentHash,
      "X-DTU-Signature": result.signature,
    });
    res.send(result.buffer);
  }));

  // ── .dtu File Format Import ─────────────────────────────────────────
  // POST /api/dtus/import — Accept .dtu file upload, parse, create DTU
  app.post("/api/dtus/import", asyncHandler(async (req, res) => {
    // Accept raw binary body or base64 JSON
    let buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (req.body?.dtuBase64) {
      buffer = Buffer.from(req.body.dtuBase64, "base64");
    } else if (req.headers["content-type"]?.includes("octet-stream")) {
      // Collect raw body
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    } else {
      return res.status(400).json({ ok: false, error: "missing_dtu_data", hint: "Send binary body or { dtuBase64: '...' }" });
    }

    // Verify the file
    const verification = verifyDTU(buffer);
    if (!verification.ok || verification.tampered) {
      return res.status(400).json({ ok: false, error: "verification_failed", detail: verification });
    }

    // Decode the file
    const decoded = decodeDTU(buffer);
    if (!decoded.ok) {
      return res.status(400).json({ ok: false, error: "decode_failed", detail: decoded.error });
    }

    const { metadata, humanLayer, coreLayer, machineLayer, header } = decoded;

    // Create DTU via the macro system, preserving lineage
    const ctx = makeCtx(req);
    const createPayload = {
      title: humanLayer?.title || humanLayer?.summary || "Imported DTU",
      content: humanLayer?.content || humanLayer?.summary || "",
      summary: humanLayer?.summary || "",
      tags: [...(humanLayer?.tags || []), "reimport"],
      source: "dtu-import",
      parents: metadata?.lineage?.parents || [],
      meta: {
        reimport: true,
        originalId: metadata?.id,
        originalCreator: metadata?.creatorId,
        originalCreatedAt: metadata?.createdAt,
        importedAt: new Date().toISOString(),
        contentHash: verification.contentHash,
        primaryType: header.primaryTypeName,
        formatType: header.formatTypeName,
      },
    };

    try {
      const out = await runMacro("dtu", "create", createPayload, ctx);
      return res.status(201).json({
        ok: true,
        dtuId: out.dtu?.id || out.id,
        metadata: {
          title: humanLayer?.title,
          originalId: metadata?.id,
          primaryType: header.primaryTypeName,
          formatType: header.formatTypeName,
          verified: !verification.tampered,
        },
        header: {
          version: header.version,
          formatType: header.formatTypeName,
          primaryType: header.primaryTypeName,
          artifactPresent: header.artifactPresent,
          layers: header.layers,
        },
      });
    } catch (e) {
      const msg = String(e?.message || e);
      return res.status(500).json({ ok: false, error: "import_create_failed", detail: msg });
    }
  }));
}
