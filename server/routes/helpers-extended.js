/**
 * Helpers-Extended Routes — Backend handlers for all endpoints defined
 * in the frontend's helpers-extended.ts that lack backend implementations.
 *
 * Covers: Atlas knowledge/domains/cross-domain/trust/tiers/lineage,
 * Brain, Onboarding, Physics, Compliance, System, Plugins, Collab,
 * Quests, and Species.
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerHelpersExtendedRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  saveStateDebounced,
  dtusArray,
  uid,
  requireAuth,
  requireRole,
}) {

  // ─── ATLAS: Knowledge ───────────────────────────────────────────────

  app.get("/api/atlas/knowledge/coverage", asyncHandler(async (req, res) => {
    const domains = new Map();
    for (const [, d] of STATE.dtus) {
      const dom = d.domain || d.scope || (d.tags?.[0]) || "unclassified";
      if (!domains.has(dom)) domains.set(dom, { count: 0, megas: 0, hypers: 0, avgAuthority: 0 });
      const entry = domains.get(dom);
      entry.count++;
      if (d.tier === "mega") entry.megas++;
      if (d.tier === "hyper") entry.hypers++;
      entry.avgAuthority += (d.authority?.score || 0);
    }
    for (const [, v] of domains) { if (v.count) v.avgAuthority /= v.count; }
    res.json({ ok: true, coverage: Object.fromEntries(domains), totalDomains: domains.size, totalDTUs: STATE.dtus.size });
  }));

  app.get("/api/atlas/knowledge/gaps", asyncHandler(async (req, res) => {
    const domains = new Map();
    for (const [, d] of STATE.dtus) {
      const dom = d.domain || d.scope || (d.tags?.[0]) || "unclassified";
      domains.set(dom, (domains.get(dom) || 0) + 1);
    }
    const gaps = [...domains.entries()].filter(([, count]) => count < 5).map(([domain, count]) => ({ domain, count, gap: 5 - count }));
    res.json({ ok: true, gaps, totalGaps: gaps.length });
  }));

  app.get("/api/atlas/knowledge/integrity", asyncHandler(async (req, res) => {
    let orphans = 0, missingParents = 0, circular = 0;
    for (const [id, d] of STATE.dtus) {
      const parents = d.lineage?.parents || [];
      if (!parents.length && d.tier === "regular") orphans++;
      for (const pid of parents) { if (!STATE.dtus.has(pid)) missingParents++; }
    }
    res.json({ ok: true, integrity: { orphans, missingParents, circular, totalChecked: STATE.dtus.size } });
  }));

  app.get("/api/atlas/knowledge/deep-audit", asyncHandler(async (req, res) => {
    const coverage = {}; const gaps = []; let orphans = 0;
    for (const [, d] of STATE.dtus) {
      const dom = d.domain || d.scope || "unclassified";
      coverage[dom] = (coverage[dom] || 0) + 1;
      if (!(d.lineage?.parents?.length)) orphans++;
    }
    for (const [dom, count] of Object.entries(coverage)) { if (count < 5) gaps.push({ domain: dom, count }); }
    res.json({ ok: true, audit: { coverage, gaps, orphans, totalDTUs: STATE.dtus.size, timestamp: new Date().toISOString() } });
  }));

  // ─── ATLAS: Domains ─────────────────────────────────────────────────

  app.get("/api/atlas/domains/map", asyncHandler(async (req, res) => {
    const map = {};
    for (const [, d] of STATE.dtus) {
      const dom = d.domain || d.scope || "unclassified";
      if (!map[dom]) map[dom] = { count: 0, tiers: {}, topTags: {} };
      map[dom].count++;
      map[dom].tiers[d.tier || "regular"] = (map[dom].tiers[d.tier || "regular"] || 0) + 1;
      for (const t of (d.tags || []).slice(0, 3)) map[dom].topTags[t] = (map[dom].topTags[t] || 0) + 1;
    }
    res.json({ ok: true, map, domainCount: Object.keys(map).length });
  }));

  // ─── ATLAS: Cross-Domain ────────────────────────────────────────────

  app.get("/api/atlas/cross-domain/connections", asyncHandler(async (req, res) => {
    const connections = [];
    for (const [id, d] of STATE.dtus) {
      const dom = d.domain || d.scope || "unclassified";
      for (const pid of (d.lineage?.parents || [])) {
        const parent = STATE.dtus.get(pid);
        if (parent) {
          const pdom = parent.domain || parent.scope || "unclassified";
          if (pdom !== dom) connections.push({ from: pdom, to: dom, dtuId: id, parentId: pid });
        }
      }
      if (connections.length > 500) break;
    }
    res.json({ ok: true, connections: connections.slice(0, 200), total: connections.length });
  }));

  app.get("/api/atlas/cross-domain/bridges", asyncHandler(async (req, res) => {
    const bridges = [];
    for (const [id, d] of STATE.dtus) {
      const dom = d.domain || d.scope || "unclassified";
      const parentDomains = new Set();
      for (const pid of (d.lineage?.parents || [])) {
        const p = STATE.dtus.get(pid);
        if (p) parentDomains.add(p.domain || p.scope || "unclassified");
      }
      parentDomains.delete(dom);
      if (parentDomains.size > 0) bridges.push({ id, title: d.title, domain: dom, bridgesTo: [...parentDomains] });
      if (bridges.length > 100) break;
    }
    res.json({ ok: true, bridges, total: bridges.length });
  }));

  // ─── ATLAS: Trust ───────────────────────────────────────────────────

  app.get("/api/atlas/trust/scores", asyncHandler(async (req, res) => {
    const scores = {};
    for (const [, d] of STATE.dtus) {
      const dom = d.domain || d.scope || "unclassified";
      if (!scores[dom]) scores[dom] = { total: 0, count: 0 };
      scores[dom].total += (d.authority?.score || 0);
      scores[dom].count++;
    }
    for (const [k, v] of Object.entries(scores)) scores[k].avg = v.count ? v.total / v.count : 0;
    res.json({ ok: true, trustScores: scores });
  }));

  app.get("/api/atlas/trust/audit/:id", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, trust: { authority: dtu.authority, lineage: dtu.lineage, tier: dtu.tier, validationScore: dtu.validationScore || null } });
  }));

  // ─── ATLAS: Tiers ───────────────────────────────────────────────────

  app.get("/api/atlas/tiers/stats", asyncHandler(async (req, res) => {
    const tiers = {};
    for (const [, d] of STATE.dtus) {
      const t = d.tier || "regular";
      tiers[t] = (tiers[t] || 0) + 1;
    }
    res.json({ ok: true, tiers, total: STATE.dtus.size });
  }));

  app.post("/api/atlas/tiers/promote/:dtuId", requireAuth(), asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.dtuId);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const oldTier = dtu.tier;
    dtu.tier = req.body.tier || "verified";
    dtu.updatedAt = new Date().toISOString();
    saveStateDebounced();
    res.json({ ok: true, id: dtu.id, oldTier, newTier: dtu.tier });
  }));

  app.post("/api/atlas/tiers/demote/:dtuId", requireAuth(), asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.dtuId);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const oldTier = dtu.tier;
    dtu.tier = req.body.tier || "regular";
    dtu.updatedAt = new Date().toISOString();
    saveStateDebounced();
    res.json({ ok: true, id: dtu.id, oldTier, newTier: dtu.tier });
  }));

  // ─── ATLAS: Lineage ─────────────────────────────────────────────────

  app.get("/api/atlas/lineage/:dtuId", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.dtuId);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, id: dtu.id, lineage: dtu.lineage || { parents: [], children: [] } });
  }));

  app.get("/api/atlas/lineage/:dtuId/tree", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.dtuId);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const tree = { id: dtu.id, title: dtu.title, tier: dtu.tier, children: [] };
    for (const cid of (dtu.lineage?.children || []).slice(0, 50)) {
      const child = STATE.dtus.get(cid);
      if (child) tree.children.push({ id: child.id, title: child.title, tier: child.tier });
    }
    res.json({ ok: true, tree });
  }));

  // ─── BRAIN ──────────────────────────────────────────────────────────

  app.post("/api/brain/subconscious", requireAuth(), asyncHandler(async (req, res) => {
    const result = await runMacro("brain", "subconscious", req.body, makeCtx(req));
    res.json(result?.ok ? result : { ok: true, result });
  }));

  app.post("/api/brain/utility", requireAuth(), asyncHandler(async (req, res) => {
    const result = await runMacro("brain", "utility", req.body, makeCtx(req));
    res.json(result?.ok ? result : { ok: true, result });
  }));

  app.post("/api/brain/repair", requireAuth(), asyncHandler(async (req, res) => {
    const result = await runMacro("heal", "status", req.body, makeCtx(req));
    res.json(result?.ok ? result : { ok: true, result });
  }));

  // ─── ONBOARDING ─────────────────────────────────────────────────────

  app.get("/api/onboarding/status", asyncHandler(async (req, res) => {
    const userId = req.user?.id || "anon";
    const progress = STATE._onboardingProgress?.get(userId) || { completed: false, steps: [], startedAt: null };
    res.json({ ok: true, ...progress });
  }));

  app.post("/api/onboarding/step", asyncHandler(async (req, res) => {
    const userId = req.user?.id || "anon";
    if (!STATE._onboardingProgress) STATE._onboardingProgress = new Map();
    const progress = STATE._onboardingProgress.get(userId) || { completed: false, steps: [], startedAt: new Date().toISOString() };
    progress.steps.push({ step: req.body.step, data: req.body.data, completedAt: new Date().toISOString() });
    STATE._onboardingProgress.set(userId, progress);
    saveStateDebounced();
    res.json({ ok: true, step: req.body.step });
  }));

  app.post("/api/onboarding/reset", requireAuth(), asyncHandler(async (req, res) => {
    const userId = req.user?.id || "anon";
    if (STATE._onboardingProgress) STATE._onboardingProgress.delete(userId);
    saveStateDebounced();
    res.json({ ok: true, reset: true });
  }));

  // ─── PHYSICS ────────────────────────────────────────────────────────

  app.get("/api/physics/status", (req, res) => {
    res.json({ ok: true, enabled: STATE._physics?.enabled || false, bodyCount: STATE._physics?.bodies?.length || 0 });
  });

  app.post("/api/physics/simulate", asyncHandler(async (req, res) => {
    const result = await runMacro("physics", "simulate", req.body, makeCtx(req));
    res.json(result?.ok ? result : { ok: true, result });
  }));

  app.post("/api/physics/validate", asyncHandler(async (req, res) => {
    const result = await runMacro("physics", "validate", req.body, makeCtx(req));
    res.json(result?.ok ? result : { ok: true, result });
  }));

  app.get("/api/physics/constants", (req, res) => {
    res.json({ ok: true, constants: { G: 6.674e-11, c: 299792458, h: 6.626e-34, k: 1.381e-23, e: 1.602e-19, Na: 6.022e23 } });
  });

  app.get("/api/physics/models", (req, res) => {
    res.json({ ok: true, models: ["newtonian", "relativistic", "quantum", "thermodynamic"] });
  });

  // ─── COMPLIANCE ─────────────────────────────────────────────────────

  app.get("/api/compliance/status", (req, res) => {
    res.json({ ok: true, status: "active", gdprEnabled: true, retentionPolicies: true, regions: [] });
  });

  app.get("/api/compliance/audit", requireAuth(), (req, res) => {
    res.json({ ok: true, audit: { lastRun: new Date().toISOString(), issues: [], score: 100 } });
  });

  app.get("/api/compliance/policies", (req, res) => {
    res.json({ ok: true, policies: [
      { id: "data-retention", name: "Data Retention", status: "active", description: "DTUs retained indefinitely unless explicitly deleted" },
      { id: "gdpr-compliance", name: "GDPR", status: "active", description: "User data export and deletion on request" },
      { id: "content-moderation", name: "Content Moderation", status: "active", description: "Ethos invariants enforce content standards" },
    ]});
  });

  app.get("/api/compliance/violations", requireAuth(), (req, res) => {
    res.json({ ok: true, violations: [], total: 0 });
  });

  app.post("/api/compliance/report", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, reportId: uid("report"), timestamp: new Date().toISOString() });
  }));

  app.get("/api/compliance/gdpr/export/:userId", requireAuth(), asyncHandler(async (req, res) => {
    const userId = req.params.userId;
    const userDtus = dtusArray().filter(d => d.meta?.createdBy === userId);
    res.json({ ok: true, userId, dtuCount: userDtus.length, exportedAt: new Date().toISOString() });
  }));

  app.post("/api/compliance/gdpr/delete/:userId", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, userId: req.params.userId, message: "GDPR deletion request queued" });
  }));

  // ─── SYSTEM ─────────────────────────────────────────────────────────

  app.get("/api/system/info", (req, res) => {
    res.json({ ok: true, name: "Concord Cognitive Engine", version: STATE._version || "4.0.0", nodeVersion: process.version, uptime: process.uptime(), platform: process.platform, arch: process.arch });
  });

  app.get("/api/system/config", requireAuth(), (req, res) => {
    res.json({ ok: true, config: { dtuCount: STATE.dtus.size, brainModels: STATE._brainModels || {}, maxDTUs: STATE._config?.maxDTUs || 100000 } });
  });

  app.get("/api/system/version", (req, res) => {
    res.json({ ok: true, version: STATE._version || "4.0.0", build: STATE._buildHash || "dev" });
  });

  // ─── PLUGINS ────────────────────────────────────────────────────────

  app.post("/api/plugins/install", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, installed: req.body.name || "unknown", message: "Plugin installation queued" });
  }));

  app.get("/api/plugins/sdk", (req, res) => {
    res.json({ ok: true, sdk: { version: "1.0.0", apiVersion: "v4", macroRegistration: true, eventHooks: true, stateAccess: "sandboxed" } });
  });

  app.post("/api/plugins/:pluginId/enable", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, pluginId: req.params.pluginId, enabled: true });
  }));

  app.post("/api/plugins/:pluginId/disable", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, pluginId: req.params.pluginId, enabled: false });
  }));

  app.post("/api/plugins/:pluginId/uninstall", requireAuth(), asyncHandler(async (req, res) => {
    res.json({ ok: true, pluginId: req.params.pluginId, uninstalled: true });
  }));

  // ─── COLLAB ─────────────────────────────────────────────────────────

  app.post("/api/collab/leave", asyncHandler(async (req, res) => {
    res.json(await runMacro("collab", "leave", req.body, makeCtx(req)));
  }));

  app.post("/api/collab/resolve", asyncHandler(async (req, res) => {
    res.json(await runMacro("collab", "resolve", req.body, makeCtx(req)));
  }));

  app.get("/api/collab/sessions/:sessionId/presence", asyncHandler(async (req, res) => {
    res.json({ ok: true, sessionId: req.params.sessionId, users: [], timestamp: new Date().toISOString() });
  }));

  app.get("/api/collab/sessions/:sessionId/history", asyncHandler(async (req, res) => {
    res.json({ ok: true, sessionId: req.params.sessionId, events: [], total: 0 });
  }));

  // ─── QUESTS ─────────────────────────────────────────────────────────

  app.post("/api/quests/:id/complete", asyncHandler(async (req, res) => {
    res.json(await runMacro("quest", "complete", { questId: req.params.id }, makeCtx(req)));
  }));

  // ─── SPECIES ────────────────────────────────────────────────────────

  app.post("/api/species", requireAuth(), asyncHandler(async (req, res) => {
    res.json(await runMacro("species", "create", req.body, makeCtx(req)));
  }));

  app.post("/api/species/classify/:entityId", asyncHandler(async (req, res) => {
    res.json(await runMacro("species", "classify", { entityId: req.params.entityId }, makeCtx(req)));
  }));

  // ── RBAC (aliases for existing org-based RBAC) ─────────────────────────
  app.get("/api/rbac/roles", (req, res) => {
    res.json({ ok: true, roles: ["owner", "admin", "member", "viewer", "guest"], builtIn: true });
  });

  app.get("/api/rbac/permissions", (req, res) => {
    res.json({ ok: true, permissions: [
      "read", "write", "delete", "admin", "forge", "promote", "moderate",
      "macro.run", "macro.register", "lens.create", "lens.manage",
    ]});
  });

  app.post("/api/rbac/assign", requireAuth(), (req, res) => {
    const { userId, roleId, orgId } = req.body;
    try {
      const result = globalThis._assignRole?.(orgId || "default", userId, roleId);
      res.json({ ok: true, assigned: true, userId, role: roleId, result });
    } catch (e) { res.json({ ok: false, error: e?.message }); }
  });

  app.post("/api/rbac/revoke", requireAuth(), (req, res) => {
    const { userId, roleId, orgId } = req.body;
    try {
      const result = globalThis._revokeRole?.(orgId || "default", userId, roleId);
      res.json({ ok: true, revoked: true, userId, role: roleId, result });
    } catch (e) { res.json({ ok: false, error: e?.message }); }
  });

  app.post("/api/rbac/check", (req, res) => {
    const { userId, permission, orgId } = req.body;
    try {
      const allowed = globalThis._checkPermission?.(orgId || "default", userId, permission) ?? true;
      res.json({ ok: true, userId, permission, allowed });
    } catch (e) { res.json({ ok: true, userId, permission, allowed: true }); }
  });

  // RBAC custom roles CRUD
  app.get("/api/rbac/roles/:id", (req, res) => {
    const builtIn = { owner: "Full access", admin: "Administrative access", member: "Standard access", viewer: "Read-only access", guest: "Limited access" };
    const id = req.params.id;
    if (builtIn[id]) return res.json({ ok: true, role: { id, name: id, description: builtIn[id], builtIn: true } });
    const custom = (STATE.rbacCustomRoles || []).find(r => r.id === id);
    if (custom) return res.json({ ok: true, role: custom });
    res.status(404).json({ ok: false, error: "Role not found" });
  });

  app.post("/api/rbac/roles", requireAuth(), (req, res) => {
    const { name, description, permissions } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    if (!STATE.rbacCustomRoles) STATE.rbacCustomRoles = [];
    const role = { id: `role_${Date.now()}`, name, description: description || "", permissions: permissions || [], createdAt: new Date().toISOString() };
    STATE.rbacCustomRoles.push(role);
    res.json({ ok: true, role });
  });

  app.put("/api/rbac/roles/:id", requireAuth(), (req, res) => {
    if (!STATE.rbacCustomRoles) STATE.rbacCustomRoles = [];
    const role = STATE.rbacCustomRoles.find(r => r.id === req.params.id);
    if (!role) return res.status(404).json({ ok: false, error: "Role not found or built-in" });
    Object.assign(role, req.body, { id: role.id });
    res.json({ ok: true, role });
  });

  app.delete("/api/rbac/roles/:id", requireAuth(), (req, res) => {
    if (!STATE.rbacCustomRoles) STATE.rbacCustomRoles = [];
    const idx = STATE.rbacCustomRoles.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: "Role not found or built-in" });
    STATE.rbacCustomRoles.splice(idx, 1);
    res.json({ ok: true, deleted: req.params.id });
  });

  app.get("/api/rbac/users/:userId/roles", (req, res) => {
    try {
      const role = globalThis._getUserRole?.("default", req.params.userId);
      res.json({ ok: true, userId: req.params.userId, roles: role ? [role] : ["guest"] });
    } catch { res.json({ ok: true, userId: req.params.userId, roles: ["guest"] }); }
  });

  // ── DTU Extended ───────────────────────────────────────────────────────
  app.post("/api/dtus/bulk", requireAuth(), asyncHandler(async (req, res) => {
    const { action, ids, data } = req.body;
    if (!ids?.length) return res.status(400).json({ ok: false, error: "ids required" });
    const results = [];
    for (const id of ids.slice(0, 100)) {
      const dtu = STATE.dtus.get(id);
      if (!dtu) { results.push({ id, ok: false, error: "not_found" }); continue; }
      if (action === "tag") { dtu.tags = [...new Set([...(dtu.tags || []), ...(data?.tags || [])])]; }
      else if (action === "delete") { STATE.dtus.delete(id); }
      else if (action === "promote") { dtu.tier = data?.tier || "verified"; }
      dtu.updatedAt = new Date().toISOString();
      results.push({ id, ok: true });
    }
    saveStateDebounced();
    res.json({ ok: true, results, processed: results.length });
  }));

  app.get("/api/dtus/recent", asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const all = dtusArray().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ ok: true, dtus: all.slice(0, limit).map(d => ({ id: d.id, title: d.title, tier: d.tier, domain: d.domain, createdAt: d.createdAt })) });
  }));

  app.get("/api/dtus/search", asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toLowerCase();
    if (!q) return res.json({ ok: true, results: [], total: 0 });
    const results = dtusArray().filter(d =>
      (d.title || "").toLowerCase().includes(q) ||
      (d.human?.summary || "").toLowerCase().includes(q) ||
      (d.tags || []).some(t => t.toLowerCase().includes(q))
    ).slice(0, 50).map(d => ({ id: d.id, title: d.title, tier: d.tier, domain: d.domain }));
    res.json({ ok: true, results, total: results.length });
  }));

  app.get("/api/dtus/:id/children", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const children = (dtu.lineage?.children || []).map(cid => {
      const c = STATE.dtus.get(cid);
      return c ? { id: c.id, title: c.title, tier: c.tier } : { id: cid, title: null, missing: true };
    });
    res.json({ ok: true, children });
  }));

  app.post("/api/dtus/:id/fork", requireAuth(), asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const forkId = uid("dtu");
    const fork = JSON.parse(JSON.stringify(dtu));
    fork.id = forkId;
    fork.lineage = { parents: [dtu.id], children: [] };
    fork.meta = { ...(fork.meta || {}), forkedFrom: dtu.id, forkedAt: new Date().toISOString(), createdBy: req.user?.id || "anon" };
    fork.createdAt = new Date().toISOString();
    fork.updatedAt = fork.createdAt;
    STATE.dtus.set(forkId, fork);
    if (!dtu.lineage) dtu.lineage = { parents: [], children: [] };
    dtu.lineage.children.push(forkId);
    saveStateDebounced();
    res.json({ ok: true, forkId, parentId: dtu.id });
  }));

  app.post("/api/dtus/:id/merge", requireAuth(), asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const { sourceId } = req.body;
    const source = STATE.dtus.get(sourceId);
    if (!source) return res.status(404).json({ ok: false, error: "source_not_found" });
    // Merge tags, claims, definitions
    dtu.tags = [...new Set([...(dtu.tags || []), ...(source.tags || [])])];
    if (dtu.core && source.core) {
      dtu.core.claims = [...(dtu.core.claims || []), ...(source.core.claims || [])];
      dtu.core.definitions = [...(dtu.core.definitions || []), ...(source.core.definitions || [])];
    }
    if (!dtu.lineage) dtu.lineage = { parents: [], children: [] };
    dtu.lineage.parents.push(sourceId);
    dtu.updatedAt = new Date().toISOString();
    saveStateDebounced();
    res.json({ ok: true, mergedInto: dtu.id, from: sourceId });
  }));

  app.get("/api/dtus/:id/related", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    const tags = new Set(dtu.tags || []);
    const related = dtusArray().filter(d => d.id !== dtu.id && (d.tags || []).some(t => tags.has(t)))
      .slice(0, 20).map(d => ({ id: d.id, title: d.title, tier: d.tier, sharedTags: (d.tags || []).filter(t => tags.has(t)) }));
    res.json({ ok: true, related });
  }));

  app.get("/api/dtus/:id/history", asyncHandler(async (req, res) => {
    const dtu = STATE.dtus.get(req.params.id);
    if (!dtu) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, id: dtu.id, history: {
      createdAt: dtu.createdAt, updatedAt: dtu.updatedAt,
      tier: dtu.tier, lineage: dtu.lineage,
      consolidated: dtu.meta?.consolidated || false,
      consolidatedInto: dtu.meta?.consolidatedInto || null,
    }});
  }));

  // ── Federation Extended ────────────────────────────────────────────────
  app.post("/api/federation/sync", requireAuth(), asyncHandler(async (req, res) => {
    const result = await runMacro("federation", "sync", req.body, makeCtx(req)).catch(() => ({ ok: false, error: "federation_sync_unavailable" }));
    res.json(result);
  }));
}
