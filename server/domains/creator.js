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
    for (const k of [
      "platforms", "content", "audience", "revenue", "goal",
      // Parity backlog extensions:
      "demographics",   // user -> [{ id, segment, label, count, date }]
      "tiers",          // user -> [{ id, name, priceMonthly, perks, createdAt }]
      "subscriptions",  // user -> [{ id, tierId, supporter, status, startedAt, cancelledAt }]
      "payouts",        // user -> [{ id, amount, method, status, note, at }]
      "publishQueue",   // user -> [{ id, title, format, body, releaseAt, status, contentId, publishedAt }]
      "comments",       // user -> [{ id, contentId, author, body, status, pinned, at }]
    ]) {
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
      // Per-artifact performance counters — all start at 0, only ever
      // moved by content-track / real platform input. Never seeded.
      views: 0, clicks: 0, conversions: 0, citations: 0, revenue: 0,
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Studio dashboard ────────────────────────────────────────────────
  registerLensAction("creator", "creator-dashboard", (ctx, _a, _params = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  // Parity backlog — YouTube Studio + Patreon feature gaps.
  // ════════════════════════════════════════════════════════════════════

  // ── [M] Time-series revenue charts ──────────────────────────────────
  // Buckets logged revenue into day / week / month series so the lens
  // can chart earnings over time. Computed entirely from real revenue
  // entries — nothing seeded.
  registerLensAction("creator", "revenue-timeseries", (ctx, _a, params = {}) => {
  try {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bucket = crtPick(params.bucket, ["day", "week", "month"], "month");
    const days = Math.max(7, Math.min(1095, Math.round(crtNum(params.days, 365))));
    const cutoff = new Date(Date.now() - days * CRT_DAY).toISOString().slice(0, 10);
    const entries = (s.revenue.get(crtAid(ctx)) || []).filter((e) => e.date >= cutoff);
    const keyOf = (dateStr) => {
      if (bucket === "month") return dateStr.slice(0, 7);
      if (bucket === "day") return dateStr;
      // week — ISO-ish: year + week number
      const d = new Date(dateStr + "T00:00:00Z");
      if (Number.isNaN(d.getTime())) return dateStr;
      const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((d - onejan) / CRT_DAY) + onejan.getUTCDay() + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    };
    const map = new Map();
    for (const e of entries) {
      const k = keyOf(e.date);
      if (!map.has(k)) map.set(k, { period: k, total: 0, bySource: {} });
      const row = map.get(k);
      row.total = Math.round((row.total + e.amount) * 100) / 100;
      row.bySource[e.source] = Math.round(((row.bySource[e.source] || 0) + e.amount) * 100) / 100;
    }
    const series = [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
    return {
      ok: true,
      result: {
        bucket, days, series, count: series.length,
        grandTotal: Math.round(series.reduce((a, r) => a + r.total, 0) * 100) / 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Per-artifact content performance ────────────────────────────
  // content-track moves real performance counters on a content item;
  // content-performance returns a per-artifact analytics table with
  // derived conversion + citation rates.
  registerLensAction("creator", "content-track", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = (s.content.get(crtAid(ctx)) || []).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "content not found" };
    const metric = crtPick(params.metric, ["views", "clicks", "conversions", "citations", "revenue"], "");
    if (!metric) return { ok: false, error: "metric must be views|clicks|conversions|citations|revenue" };
    const delta = crtNum(params.delta);
    if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "delta required" };
    if (typeof item[metric] !== "number") item[metric] = 0;
    item[metric] = metric === "revenue"
      ? Math.round(Math.max(0, item[metric] + delta) * 100) / 100
      : Math.max(0, Math.round(item[metric] + delta));
    saveCrtState();
    return { ok: true, result: { id: item.id, metric, value: item[metric] } };
  });

  registerLensAction("creator", "content-performance", (ctx, _a, params = {}) => {
  try {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let items = [...(s.content.get(crtAid(ctx)) || [])];
    if (params.format) items = items.filter((x) => x.format === String(params.format));
    const rows = items.map((c) => {
      const views = crtNum(c.views);
      const clicks = crtNum(c.clicks);
      const conversions = crtNum(c.conversions);
      const citations = crtNum(c.citations);
      const revenue = crtNum(c.revenue);
      return {
        id: c.id, title: c.title, format: c.format, stage: c.stage,
        platform: c.platform, publishedAt: c.publishedAt,
        views, clicks, conversions, citations, revenue,
        clickRate: views > 0 ? Math.round((clicks / views) * 10000) / 100 : 0,
        conversionRate: views > 0 ? Math.round((conversions / views) * 10000) / 100 : 0,
        citationRate: views > 0 ? Math.round((citations / views) * 10000) / 100 : 0,
        revenuePerView: views > 0 ? Math.round((revenue / views) * 10000) / 10000 : 0,
      };
    }).sort((a, b) => b.views - a.views);
    return {
      ok: true,
      result: {
        rows, count: rows.length,
        totals: {
          views: rows.reduce((a, r) => a + r.views, 0),
          clicks: rows.reduce((a, r) => a + r.clicks, 0),
          conversions: rows.reduce((a, r) => a + r.conversions, 0),
          citations: rows.reduce((a, r) => a + r.citations, 0),
          revenue: Math.round(rows.reduce((a, r) => a + r.revenue, 0) * 100) / 100,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Audience demographics ───────────────────────────────────────
  // The creator logs real audience segment counts (geographic / age /
  // referral / acquisition); demographics rolls them up by segment.
  const CRT_DEMO_SEGMENTS = ["geography", "age", "referral", "device", "acquisition"];
  registerLensAction("creator", "audience-demographic-log", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const segment = crtPick(params.segment, CRT_DEMO_SEGMENTS, "");
    if (!segment) return { ok: false, error: `segment must be one of ${CRT_DEMO_SEGMENTS.join("|")}` };
    const label = crtClean(params.label, 80);
    if (!label) return { ok: false, error: "label required (e.g. 'United States', '25-34')" };
    const count = Math.max(0, Math.round(crtNum(params.count)));
    const entry = {
      id: crtId("dmo"), segment, label, count,
      date: crtDay(params.date) || crtDay(crtNow()), at: crtNow(),
    };
    crtListB(s.demographics, crtAid(ctx)).push(entry);
    saveCrtState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("creator", "audience-demographics", (ctx, _a, params = {}) => {
  try {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = s.demographics.get(crtAid(ctx)) || [];
    // Latest entry per (segment,label) pair wins — re-logging a label updates it.
    const latest = new Map();
    for (const e of all) {
      const k = `${e.segment}::${e.label}`;
      const prev = latest.get(k);
      if (!prev || e.at > prev.at) latest.set(k, e);
    }
    const wanted = params.segment ? [crtPick(params.segment, CRT_DEMO_SEGMENTS, "")] : CRT_DEMO_SEGMENTS;
    const segments = {};
    for (const seg of wanted) {
      if (!seg) continue;
      const rows = [...latest.values()].filter((e) => e.segment === seg);
      const total = rows.reduce((a, r) => a + r.count, 0);
      segments[seg] = {
        total,
        breakdown: rows
          .map((r) => ({
            label: r.label, count: r.count,
            share: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
          }))
          .sort((a, b) => b.count - a.count),
      };
    }
    return { ok: true, result: { segments, segmentNames: wanted.filter(Boolean) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Membership tiers / recurring subscriptions ──────────────────
  registerLensAction("creator", "membership-tier-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = crtClean(params.name, 60);
    if (!name) return { ok: false, error: "tier name required" };
    const priceMonthly = crtNum(params.priceMonthly);
    if (!(priceMonthly > 0)) return { ok: false, error: "priceMonthly must be positive" };
    const tier = {
      id: crtId("tier"), name,
      priceMonthly: Math.round(priceMonthly * 100) / 100,
      perks: Array.isArray(params.perks)
        ? params.perks.map((p) => crtClean(p, 120)).filter(Boolean).slice(0, 12)
        : [],
      description: crtClean(params.description, 300) || null,
      createdAt: crtNow(),
    };
    crtListB(s.tiers, crtAid(ctx)).push(tier);
    saveCrtState();
    return { ok: true, result: { tier } };
  });

  registerLensAction("creator", "membership-tier-list", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const subs = s.subscriptions.get(userId) || [];
    const tiers = (s.tiers.get(userId) || []).map((t) => {
      const active = subs.filter((sub) => sub.tierId === t.id && sub.status === "active");
      return {
        ...t,
        activeSubscribers: active.length,
        monthlyRevenue: Math.round(active.length * t.priceMonthly * 100) / 100,
      };
    });
    return { ok: true, result: { tiers, count: tiers.length } };
  });

  registerLensAction("creator", "membership-tier-delete", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const arr = s.tiers.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "tier not found" };
    const hasActive = (s.subscriptions.get(userId) || [])
      .some((sub) => sub.tierId === params.id && sub.status === "active");
    if (hasActive) return { ok: false, error: "cannot delete a tier with active subscribers" };
    arr.splice(i, 1);
    saveCrtState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("creator", "subscription-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const tier = (s.tiers.get(userId) || []).find((t) => t.id === params.tierId);
    if (!tier) return { ok: false, error: "tier not found" };
    const supporter = crtClean(params.supporter, 80);
    if (!supporter) return { ok: false, error: "supporter name/handle required" };
    const sub = {
      id: crtId("sub"), tierId: tier.id, tierName: tier.name,
      supporter, priceMonthly: tier.priceMonthly,
      status: "active", startedAt: crtNow(), cancelledAt: null,
    };
    crtListB(s.subscriptions, userId).push(sub);
    saveCrtState();
    return { ok: true, result: { subscription: sub } };
  });

  registerLensAction("creator", "subscription-list", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let subs = [...(s.subscriptions.get(crtAid(ctx)) || [])];
    const status = crtPick(params.status, ["active", "cancelled", "all"], "all");
    if (status !== "all") subs = subs.filter((sub) => sub.status === status);
    if (params.tierId) subs = subs.filter((sub) => sub.tierId === String(params.tierId));
    subs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { ok: true, result: { subscriptions: subs, count: subs.length } };
  });

  registerLensAction("creator", "subscription-cancel", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sub = (s.subscriptions.get(crtAid(ctx)) || []).find((x) => x.id === params.id);
    if (!sub) return { ok: false, error: "subscription not found" };
    if (sub.status === "cancelled") return { ok: false, error: "already cancelled" };
    sub.status = "cancelled";
    sub.cancelledAt = crtNow();
    saveCrtState();
    return { ok: true, result: { subscription: sub } };
  });

  registerLensAction("creator", "membership-summary", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const subs = s.subscriptions.get(userId) || [];
    const active = subs.filter((sub) => sub.status === "active");
    const mrr = Math.round(active.reduce((a, sub) => a + crtNum(sub.priceMonthly), 0) * 100) / 100;
    return {
      ok: true,
      result: {
        tierCount: (s.tiers.get(userId) || []).length,
        activeSubscribers: active.length,
        cancelledSubscribers: subs.filter((sub) => sub.status === "cancelled").length,
        mrr,
        arr: Math.round(mrr * 12 * 100) / 100,
        avgRevenuePerSupporter: active.length
          ? Math.round((mrr / active.length) * 100) / 100 : 0,
      },
    };
  });

  // ── [S] Payout history ledger ───────────────────────────────────────
  registerLensAction("creator", "payout-record", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const amount = crtNum(params.amount);
    if (!(amount > 0)) return { ok: false, error: "amount must be positive" };
    const payout = {
      id: crtId("pay"),
      amount: Math.round(amount * 100) / 100,
      method: crtPick(params.method, ["bank", "stripe", "paypal", "crypto", "other"], "bank"),
      status: crtPick(params.status, ["pending", "completed", "failed"], "pending"),
      reference: crtClean(params.reference, 80) || null,
      note: crtClean(params.note, 200) || null,
      at: crtNow(),
      completedAt: null,
    };
    if (payout.status === "completed") payout.completedAt = crtNow();
    crtListB(s.payouts, crtAid(ctx)).push(payout);
    saveCrtState();
    return { ok: true, result: { payout } };
  });

  registerLensAction("creator", "payout-update-status", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const payout = (s.payouts.get(crtAid(ctx)) || []).find((p) => p.id === params.id);
    if (!payout) return { ok: false, error: "payout not found" };
    payout.status = crtPick(params.status, ["pending", "completed", "failed"], payout.status);
    if (payout.status === "completed" && !payout.completedAt) payout.completedAt = crtNow();
    saveCrtState();
    return { ok: true, result: { payout } };
  });

  registerLensAction("creator", "payout-history", (ctx, _a, params = {}) => {
  try {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let payouts = [...(s.payouts.get(crtAid(ctx)) || [])];
    const status = crtPick(params.status, ["pending", "completed", "failed", "all"], "all");
    if (status !== "all") payouts = payouts.filter((p) => p.status === status);
    payouts.sort((a, b) => b.at.localeCompare(a.at));
    const all = s.payouts.get(crtAid(ctx)) || [];
    return {
      ok: true,
      result: {
        payouts, count: payouts.length,
        totals: {
          completed: Math.round(all.filter((p) => p.status === "completed")
            .reduce((a, p) => a + p.amount, 0) * 100) / 100,
          pending: Math.round(all.filter((p) => p.status === "pending")
            .reduce((a, p) => a + p.amount, 0) * 100) / 100,
          failed: Math.round(all.filter((p) => p.status === "failed")
            .reduce((a, p) => a + p.amount, 0) * 100) / 100,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Scheduled publishing ────────────────────────────────────────
  registerLensAction("creator", "publish-queue-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = crtClean(params.title, 200);
    if (!title) return { ok: false, error: "title required" };
    const releaseAt = crtClean(params.releaseAt, 30);
    const releaseTime = Date.parse(releaseAt);
    if (!Number.isFinite(releaseTime)) {
      return { ok: false, error: "releaseAt must be a valid ISO timestamp" };
    }
    const queued = {
      id: crtId("pub"), title,
      format: crtPick(params.format, CRT_FORMATS, "post"),
      platform: crtClean(params.platform, 60) || null,
      body: crtClean(params.body, 4000) || null,
      releaseAt: new Date(releaseTime).toISOString(),
      contentId: crtClean(params.contentId, 60) || null,
      status: "scheduled",
      createdAt: crtNow(), publishedAt: null,
    };
    crtListB(s.publishQueue, crtAid(ctx)).push(queued);
    saveCrtState();
    return { ok: true, result: { queued } };
  });

  registerLensAction("creator", "publish-queue-list", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let q = [...(s.publishQueue.get(crtAid(ctx)) || [])];
    const status = crtPick(params.status, ["scheduled", "published", "cancelled", "all"], "all");
    if (status !== "all") q = q.filter((x) => x.status === status);
    q.sort((a, b) => a.releaseAt.localeCompare(b.releaseAt));
    const nowMs = Date.now();
    return {
      ok: true,
      result: {
        queue: q.map((x) => ({
          ...x,
          overdue: x.status === "scheduled" && Date.parse(x.releaseAt) <= nowMs,
        })),
        count: q.length,
      },
    };
  });

  registerLensAction("creator", "publish-queue-cancel", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = (s.publishQueue.get(crtAid(ctx)) || []).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "queued item not found" };
    if (item.status !== "scheduled") return { ok: false, error: "only scheduled items can be cancelled" };
    item.status = "cancelled";
    saveCrtState();
    return { ok: true, result: { cancelled: item.id } };
  });

  registerLensAction("creator", "publish-queue-run-due", (ctx, _a, _params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crtAid(ctx);
    const nowMs = Date.now();
    const published = [];
    for (const item of s.publishQueue.get(userId) || []) {
      if (item.status !== "scheduled") continue;
      if (Date.parse(item.releaseAt) > nowMs) continue;
      item.status = "published";
      item.publishedAt = crtNow();
      // If linked to a pipeline content item, flip it to published too.
      if (item.contentId) {
        const linked = (s.content.get(userId) || []).find((c) => c.id === item.contentId);
        if (linked && linked.stage !== "published") {
          linked.stage = "published";
          if (!linked.publishedAt) linked.publishedAt = crtNow();
        }
      }
      published.push({ id: item.id, title: item.title, publishedAt: item.publishedAt });
    }
    saveCrtState();
    return { ok: true, result: { published, count: published.length } };
  });

  // ── [S] Comment / community management ──────────────────────────────
  registerLensAction("creator", "comment-add", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const author = crtClean(params.author, 80);
    if (!author) return { ok: false, error: "author required" };
    const body = crtClean(params.body, 2000);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = {
      id: crtId("cmt"),
      contentId: crtClean(params.contentId, 60) || null,
      author, body,
      status: "open",      // open | replied | hidden | resolved
      pinned: false,
      reply: null,
      at: crtNow(), updatedAt: crtNow(),
    };
    crtListB(s.comments, crtAid(ctx)).push(comment);
    saveCrtState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("creator", "comment-list", (ctx, _a, params = {}) => {
  try {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let arr = [...(s.comments.get(crtAid(ctx)) || [])];
    const status = crtPick(params.status, ["open", "replied", "hidden", "resolved", "all"], "all");
    if (status !== "all") arr = arr.filter((c) => c.status === status);
    if (params.contentId) arr = arr.filter((c) => c.contentId === String(params.contentId));
    // Pinned first, then newest.
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.at.localeCompare(a.at);
    });
    const all = s.comments.get(crtAid(ctx)) || [];
    return {
      ok: true,
      result: {
        comments: arr, count: arr.length,
        byStatus: {
          open: all.filter((c) => c.status === "open").length,
          replied: all.filter((c) => c.status === "replied").length,
          hidden: all.filter((c) => c.status === "hidden").length,
          resolved: all.filter((c) => c.status === "resolved").length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("creator", "comment-update", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comment = (s.comments.get(crtAid(ctx)) || []).find((c) => c.id === params.id);
    if (!comment) return { ok: false, error: "comment not found" };
    if (params.status != null) {
      comment.status = crtPick(params.status, ["open", "replied", "hidden", "resolved"], comment.status);
    }
    if (params.reply != null) {
      const reply = crtClean(params.reply, 2000);
      comment.reply = reply || null;
      if (reply && comment.status === "open") comment.status = "replied";
    }
    if (params.pinned != null) comment.pinned = !!params.pinned;
    comment.updatedAt = crtNow();
    saveCrtState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("creator", "comment-delete", (ctx, _a, params = {}) => {
    const s = getCrtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.comments.get(crtAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "comment not found" };
    arr.splice(i, 1);
    saveCrtState();
    return { ok: true, result: { deleted: params.id } };
  });
}
