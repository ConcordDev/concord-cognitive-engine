// server/domains/creator.js
// Creator dashboard lens. Surfaces the caller's DTU production, royalty
// income, citation graph entry-points, and audience metrics. Pulls from
// the existing economy + DTU substrate; no parallel state.

export default function registerCreatorActions(registerLensAction) {
  /**
   * dashboard — single rollup the lens page renders into a header.
   */
  registerLensAction("creator", "dashboard", (ctx) => {
    const STATE = globalThis._concordSTATE;
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth_required" };

    const items = [];
    let dtuCount = 0;
    let publishedCount = 0;
    if (STATE?.dtus) {
      for (const dtu of STATE.dtus.values?.() ?? []) {
        if (dtu.ownerUserId !== userId) continue;
        dtuCount++;
        if (dtu.visibility === "marketplace" || dtu.visibility === "public") {
          publishedCount++;
        }
        if (items.length < 10) {
          items.push({
            dtuId: dtu.id,
            title: dtu.title,
            visibility: dtu.visibility ?? "private",
            createdAt: dtu.createdAt,
          });
        }
      }
    }

    return {
      ok: true,
      result: {
        userId,
        dtuCount,
        publishedCount,
        recentDTUs: items,
      },
    };
  });

  /**
   * royalty-summary — placeholder for the royalty cascade ledger view.
   * The actual ledger is queried via /api/economy/* routes; this macro
   * exposes a small summary for the lens header chip.
   */
  registerLensAction("creator", "royalty-summary", (ctx) => {
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth_required" };
    // Real numbers come from /api/economy/royalty/cascade-earnings/:userId.
    return { ok: true, result: { userId, summaryEndpoint: `/api/economy/royalty/cascade-earnings/${userId}` } };
  });

  // ─── YouTube Studio + Buffer + Patreon 2026 parity — creator studio ─
  // A content pipeline, multi-platform audience tracking, revenue by
  // source, a publishing calendar and creator goals.

  function getCrtState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.creatorLens) STATE.creatorLens = {};
    const s = STATE.creatorLens;
    for (const k of ["platforms", "content", "audience", "revenue", "goal"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveCrtState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const crtId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const crtNow = () => new Date().toISOString();
  const crtAid = (ctx) => ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || "anon";
  const crtListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const crtNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const crtClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const crtPick = (v, allowed, dflt) => (allowed.includes(String(v)) ? String(v) : dflt);
  const crtDay = (v) => crtClean(v, 10).slice(0, 10);
  const CRT_DAY = 86400000;

  const CRT_STAGES = ["idea", "scripted", "in_production", "scheduled", "published"];
  const CRT_FORMATS = ["video", "short", "post", "article", "podcast", "stream", "newsletter", "other"];
  const CRT_REVENUE_SOURCES = ["ad_revenue", "sponsorship", "memberships", "merch", "tips", "affiliate", "other"];
  const CRT_GOAL_METRICS = ["followers", "monthly_revenue", "monthly_posts"];

  // ── Platforms ───────────────────────────────────────────────────────
  registerLensAction("creator", "platform-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = crtClean(params.name, 60);
    if (!name) return { ok: false, error: "platform name required" };
    const platform = {
      id: crtId("plt"), name,
      handle: crtClean(params.handle, 80) || null,
      createdAt: crtNow(),
    };
    crtListB(s.platforms, crtAid(ctx)).push(platform);
    saveCrtState();
    return { ok: true, result: { platform } };
  });

  registerLensAction("creator", "platform-list", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const audience = s.audience.get(userId) || [];
    const platforms = (s.platforms.get(userId) || []).map((p) => {
      const snaps = audience.filter((a) => a.platformId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      return { ...p, followers: snaps.length ? snaps[snaps.length - 1].followers : 0 };
    });
    return { ok: true, result: { platforms, count: platforms.length } };
  });

  registerLensAction("creator", "platform-delete", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const arr = s.platforms.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "platform not found" };
    arr.splice(i, 1);
    s.audience.set(userId, (s.audience.get(userId) || []).filter((a) => a.platformId !== params.id));
    saveCrtState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Content pipeline ────────────────────────────────────────────────
  registerLensAction("creator", "content-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = crtClean(params.title, 200);
    if (!title) return { ok: false, error: "content title required" };
    const item = {
      id: crtId("con"), title,
      format: crtPick(params.format, CRT_FORMATS, "video"),
      platform: crtClean(params.platform, 60) || null,
      stage: crtPick(params.stage, CRT_STAGES, "idea"),
      scheduledDate: crtDay(params.scheduledDate) || null,
      notes: crtClean(params.notes, 1000) || null,
      createdAt: crtNow(), publishedAt: null,
    };
    if (item.stage === "published") item.publishedAt = crtNow();
    crtListB(s.content, crtAid(ctx)).push(item);
    saveCrtState();
    return { ok: true, result: { item } };
  });

  registerLensAction("creator", "content-list", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = s.content.get(crtAid(ctx)) || [];
    let items = [...all];
    if (params.stage) items = items.filter((x) => x.stage === String(params.stage));
    if (params.platform) items = items.filter((x) => x.platform === String(params.platform));
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const byStage = {};
    for (const st of CRT_STAGES) byStage[st] = all.filter((x) => x.stage === st).length;
    return { ok: true, result: { items, count: items.length, byStage } };
  });

  registerLensAction("creator", "content-update", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = (s.content.get(crtAid(ctx)) || []).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "content not found" };
    if (params.title != null) item.title = crtClean(params.title, 200) || item.title;
    if (params.format != null) item.format = crtPick(params.format, CRT_FORMATS, item.format);
    if (params.platform != null) item.platform = crtClean(params.platform, 60) || null;
    if (params.scheduledDate != null) item.scheduledDate = crtDay(params.scheduledDate) || null;
    if (params.notes != null) item.notes = crtClean(params.notes, 1000) || null;
    if (params.stage != null) {
      item.stage = crtPick(params.stage, CRT_STAGES, item.stage);
      if (item.stage === "published" && !item.publishedAt) item.publishedAt = crtNow();
    }
    saveCrtState();
    return { ok: true, result: { item } };
  });

  registerLensAction("creator", "content-advance", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = (s.content.get(crtAid(ctx)) || []).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "content not found" };
    const i = CRT_STAGES.indexOf(item.stage);
    if (i < CRT_STAGES.length - 1) {
      item.stage = CRT_STAGES[i + 1];
      if (item.stage === "published") item.publishedAt = crtNow();
    }
    saveCrtState();
    return { ok: true, result: { id: item.id, stage: item.stage } };
  });

  registerLensAction("creator", "content-delete", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.content.get(crtAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "content not found" };
    arr.splice(i, 1);
    saveCrtState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Audience ────────────────────────────────────────────────────────
  registerLensAction("creator", "audience-log", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const platform = (s.platforms.get(userId) || []).find((p) => p.id === params.platformId);
    if (!platform) return { ok: false, error: "platform not found" };
    const snapshot = {
      id: crtId("aud"), platformId: platform.id,
      followers: Math.max(0, Math.round(crtNum(params.followers))),
      date: crtDay(params.date) || crtDay(crtNow()),
    };
    crtListB(s.audience, userId).push(snapshot);
    saveCrtState();
    return { ok: true, result: { snapshot } };
  });

  registerLensAction("creator", "audience-history", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let snaps = [...(s.audience.get(crtAid(ctx)) || [])];
    if (params.platformId) snaps = snaps.filter((a) => a.platformId === String(params.platformId));
    snaps.sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, result: { snapshots: snaps, count: snaps.length } };
  });

  registerLensAction("creator", "audience-summary", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const audience = s.audience.get(userId) || [];
    const platforms = (s.platforms.get(userId) || []).map((p) => {
      const snaps = audience.filter((a) => a.platformId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      const current = snaps.length ? snaps[snaps.length - 1].followers : 0;
      const first = snaps.length ? snaps[0].followers : 0;
      return { platformId: p.id, name: p.name, followers: current, growth: current - first };
    });
    return {
      ok: true,
      result: {
        platforms,
        totalFollowers: platforms.reduce((a, p) => a + p.followers, 0),
        totalGrowth: platforms.reduce((a, p) => a + p.growth, 0),
      },
    };
  });

  // ── Revenue ─────────────────────────────────────────────────────────
  registerLensAction("creator", "revenue-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const amount = crtNum(params.amount);
    if (!(amount > 0)) return { ok: false, error: "amount must be positive" };
    const entry = {
      id: crtId("rev"),
      source: crtPick(params.source, CRT_REVENUE_SOURCES, "other"),
      amount: Math.round(amount * 100) / 100,
      note: crtClean(params.note, 200) || null,
      date: crtDay(params.date) || crtDay(crtNow()),
      at: crtNow(),
    };
    crtListB(s.revenue, crtAid(ctx)).push(entry);
    saveCrtState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("creator", "revenue-list", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(730, Math.round(crtNum(params.days, 90))));
    const cutoff = new Date(Date.now() - days * CRT_DAY).toISOString().slice(0, 10);
    const entries = (s.revenue.get(crtAid(ctx)) || [])
      .filter((e) => e.date >= cutoff)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("creator", "revenue-summary", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = s.revenue.get(crtAid(ctx)) || [];
    const month = crtNow().slice(0, 7);
    const bySource = {};
    for (const src of CRT_REVENUE_SOURCES) bySource[src] = 0;
    for (const e of entries) bySource[e.source] = (bySource[e.source] || 0) + e.amount;
    for (const k of Object.keys(bySource)) bySource[k] = Math.round(bySource[k] * 100) / 100;
    return {
      ok: true,
      result: {
        total: Math.round(entries.reduce((a, e) => a + e.amount, 0) * 100) / 100,
        thisMonth: Math.round(entries.filter((e) => e.date.startsWith(month))
          .reduce((a, e) => a + e.amount, 0) * 100) / 100,
        bySource,
      },
    };
  });

  // ── Publishing calendar ─────────────────────────────────────────────
  registerLensAction("creator", "content-calendar", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = new Date();
    const year = Math.round(crtNum(params.year, now.getUTCFullYear()));
    const month = Math.max(1, Math.min(12, Math.round(crtNum(params.month, now.getUTCMonth() + 1))));
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const days = {};
    for (const c of s.content.get(crtAid(ctx)) || []) {
      if (c.scheduledDate && c.scheduledDate.startsWith(prefix)) {
        const d = c.scheduledDate.slice(8, 10);
        if (!days[d]) days[d] = [];
        days[d].push({ id: c.id, title: c.title, format: c.format, stage: c.stage });
      }
    }
    return { ok: true, result: { year, month, days } };
  });

  // ── Goals ───────────────────────────────────────────────────────────
  registerLensAction("creator", "creator-goal-set", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = crtPick(params.metric, CRT_GOAL_METRICS, "followers");
    const target = Math.max(1, Math.round(crtNum(params.target)));
    s.goal.set(crtAid(ctx), { metric, target, updatedAt: crtNow() });
    saveCrtState();
    return { ok: true, result: { metric, target } };
  });

  registerLensAction("creator", "creator-goal-status", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const goal = s.goal.get(userId);
    if (!goal) return { ok: true, result: { hasGoal: false } };
    let current = 0;
    if (goal.metric === "followers") {
      const audience = s.audience.get(userId) || [];
      for (const p of s.platforms.get(userId) || []) {
        const snaps = audience.filter((a) => a.platformId === p.id).sort((a, b) => a.date.localeCompare(b.date));
        if (snaps.length) current += snaps[snaps.length - 1].followers;
      }
    } else if (goal.metric === "monthly_revenue") {
      const month = crtNow().slice(0, 7);
      current = (s.revenue.get(userId) || []).filter((e) => e.date.startsWith(month))
        .reduce((a, e) => a + e.amount, 0);
    } else if (goal.metric === "monthly_posts") {
      const month = crtNow().slice(0, 7);
      current = (s.content.get(userId) || [])
        .filter((c) => c.publishedAt && c.publishedAt.slice(0, 7) === month).length;
    }
    current = Math.round(current * 100) / 100;
    return {
      ok: true,
      result: {
        hasGoal: true, metric: goal.metric, target: goal.target, current,
        pct: Math.round((current / goal.target) * 100),
        met: current >= goal.target,
      },
    };
  });

  // ── Studio dashboard ────────────────────────────────────────────────
  registerLensAction("creator", "creator-dashboard", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const content = s.content.get(userId) || [];
    const audience = s.audience.get(userId) || [];
    const month = crtNow().slice(0, 7);
    let totalFollowers = 0;
    for (const p of s.platforms.get(userId) || []) {
      const snaps = audience.filter((a) => a.platformId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      if (snaps.length) totalFollowers += snaps[snaps.length - 1].followers;
    }
    return {
      ok: true,
      result: {
        platforms: (s.platforms.get(userId) || []).length,
        totalFollowers,
        ideas: content.filter((c) => c.stage === "idea").length,
        inProgress: content.filter((c) => !["idea", "published"].includes(c.stage)).length,
        published: content.filter((c) => c.stage === "published").length,
        publishedThisMonth: content.filter((c) => c.publishedAt && c.publishedAt.slice(0, 7) === month).length,
        revenueThisMonth: Math.round((s.revenue.get(userId) || [])
          .filter((e) => e.date.startsWith(month)).reduce((a, e) => a + e.amount, 0) * 100) / 100,
      },
    };
  });
}
