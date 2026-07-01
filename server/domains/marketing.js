// server/domains/marketing.js
export default function registerMarketingActions(registerLensAction) {
  // Fail-CLOSED numeric coercion for the pure calculators: any non-finite input
  // (NaN / Infinity / "Infinity" / "1e999" / "abc") collapses to the default so
  // no NaN/Infinity ever leaks into a rendered metric. parseFloat/parseInt alone
  // do NOT guard Infinity — `parseFloat("Infinity")` is `Infinity` (truthy), so
  // `parseFloat(x) || 0` passed it straight through to roi / totalSpend, and the
  // rendered card then showed "Infinity%"/"null". Number.isFinite is the gate.
  const finFloat = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const finInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

  registerLensAction("marketing", "campaignROI", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const spend = Math.max(0, finFloat(data.spend));
    const revenue = Math.max(0, finFloat(data.revenue));
    const leads = Math.max(0, finInt(data.leads));
    const conversions = Math.max(0, finInt(data.conversions));
    const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
    const cpl = leads > 0 ? Math.round(spend / leads * 100) / 100 : 0;
    const cpa = conversions > 0 ? Math.round(spend / conversions * 100) / 100 : 0;
    const convRate = leads > 0 ? Math.round((conversions / leads) * 100) : 0;
    return { ok: true, result: { campaign: data.name || artifact.title, spend, revenue, roi, leads, conversions, costPerLead: cpl, costPerAcquisition: cpa, conversionRate: convRate, profitable: roi > 0, grade: roi > 200 ? "exceptional" : roi > 100 ? "strong" : roi > 0 ? "positive" : "negative" } };
  });
  registerLensAction("marketing", "abTestAnalysis", (ctx, artifact, _params) => {
    const variants = artifact.data?.variants || [];
    if (variants.length < 2) return { ok: true, result: { message: "Add at least 2 variants with visitors and conversions." } };
    const analyzed = variants.map(v => { const visitors = Math.max(1, finInt(v.visitors, 1)); const conversions = Math.max(0, finInt(v.conversions)); return { name: String(v?.name ?? ""), visitors, conversions, conversionRate: Math.round((conversions / visitors) * 10000) / 100 }; });
    const winner = analyzed.sort((a, b) => b.conversionRate - a.conversionRate)[0];
    const loser = analyzed[analyzed.length - 1];
    const lift = loser.conversionRate > 0 ? Math.round(((winner.conversionRate - loser.conversionRate) / loser.conversionRate) * 100) : 0;
    const totalVisitors = analyzed.reduce((s, v) => s + v.visitors, 0);
    const significant = totalVisitors > 1000 && Math.abs(lift) > 5;
    return { ok: true, result: { variants: analyzed, winner: winner.name, lift, statisticallySignificant: significant, totalVisitors, recommendation: significant ? `Deploy ${winner.name} — ${lift}% improvement` : "Continue testing — need more data" } };
  });
  registerLensAction("marketing", "funnelOptimize", (ctx, artifact, _params) => {
    const stages = artifact.data?.stages || [];
    if (stages.length < 2) return { ok: true, result: { message: "Add funnel stages with visitor counts." } };
    const top = Math.max(0, finInt(stages[0]?.count));
    const analyzed = stages.map((s, i) => {
      const count = Math.max(0, finInt(s?.count));
      const prev = i > 0 ? Math.max(1, finInt(stages[i - 1]?.count, 1)) : count;
      // dropoff is the % lost from the prior stage, clamped to [0,100] — a stage
      // that grows (count > prev) or has a 0/garbage prior never emits a negative
      // or out-of-range leak.
      const dropoff = i > 0 ? Math.max(0, Math.min(100, Math.round((1 - count / prev) * 100))) : 0;
      const convFromTop = top > 0 ? Math.round((count / top) * 100) : 0;
      return { stage: String(s?.name ?? ""), visitors: count, dropoff, convFromTop };
    });
    const worstDropoff = analyzed.slice(1).sort((a, b) => b.dropoff - a.dropoff)[0];
    return { ok: true, result: { stages: analyzed, overallConversion: analyzed[analyzed.length - 1]?.convFromTop || 0, biggestLeakage: worstDropoff?.stage, leakageRate: worstDropoff?.dropoff, quickWin: worstDropoff ? `Improving ${worstDropoff.stage} could recover ${worstDropoff.dropoff}% of visitors` : "Funnel is healthy" } };
  });
  registerLensAction("marketing", "audienceSegment", (ctx, artifact, _params) => {
    const users = artifact.data?.users || [];
    if (users.length === 0) return { ok: true, result: { message: "Add user data to segment audience." } };
    const segments = {};
    for (const u of users) { const seg = String(u?.segment || u?.tier || "general"); if (!segments[seg]) segments[seg] = { count: 0, totalSpend: 0 }; segments[seg].count++; segments[seg].totalSpend += Math.max(0, finFloat(u?.spend ?? u?.ltv)); }
    const ranked = Object.entries(segments).map(([name, data]) => ({ segment: name, users: data.count, totalSpend: Math.round(data.totalSpend), avgSpend: Math.round(data.totalSpend / data.count * 100) / 100, share: Math.round((data.count / users.length) * 100) })).sort((a, b) => b.avgSpend - a.avgSpend);
    return { ok: true, result: { totalUsers: users.length, segments: ranked, highValue: ranked[0]?.segment, pareto: ranked[0] && ranked[0].totalSpend / ranked.reduce((s, r) => s + r.totalSpend, 0) > 0.5 ? "Top segment drives >50% of revenue" : "Revenue is distributed across segments" } };
  });

  // ─── HubSpot + marketing-dashboard 2026 parity ──────────────────────
  // Campaigns with daily metrics, computed KPIs (CTR/CPC/CPA/ROAS),
  // channel performance, leads with scoring + pipeline, content
  // calendar, A/B tests, attribution and audience segments.

  function getMktState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.marketingLens) STATE.marketingLens = {};
    const s = STATE.marketingLens;
    for (const k of ["campaigns", "metrics", "leads", "content", "abtests", "segments"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveMktState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mkId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mkNow = () => new Date().toISOString();
  const mkAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mkListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const mkNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mkClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const mkDay = (v) => mkClean(v, 10).slice(0, 10);
  const findCampaign = (s, userId, id) => (s.campaigns.get(userId) || []).find((c) => c.id === id) || null;
  const CHANNELS = ["email", "social", "search", "display", "content", "affiliate", "video", "events", "direct"];
  const LEAD_STAGES = ["new", "contacted", "qualified", "opportunity", "won", "lost"];

  // Aggregate raw metric totals into real marketing KPIs.
  function computeKpis(rows) {
    const t = { impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0 };
    for (const r of rows) {
      t.impressions += mkNum(r.impressions);
      t.clicks += mkNum(r.clicks);
      t.conversions += mkNum(r.conversions);
      t.spend += mkNum(r.spend);
      t.revenue += mkNum(r.revenue);
    }
    return {
      ...t,
      spend: Math.round(t.spend * 100) / 100,
      revenue: Math.round(t.revenue * 100) / 100,
      ctr: t.impressions > 0 ? Math.round((t.clicks / t.impressions) * 10000) / 100 : 0,
      cpc: t.clicks > 0 ? Math.round((t.spend / t.clicks) * 100) / 100 : 0,
      cpa: t.conversions > 0 ? Math.round((t.spend / t.conversions) * 100) / 100 : 0,
      conversionRate: t.clicks > 0 ? Math.round((t.conversions / t.clicks) * 10000) / 100 : 0,
      roas: t.spend > 0 ? Math.round((t.revenue / t.spend) * 100) / 100 : 0,
    };
  }

  // ── Campaigns ───────────────────────────────────────────────────────
  registerLensAction("marketing", "campaign-create", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "campaign name required" };
    const campaign = {
      id: mkId("cmp"), name,
      channel: CHANNELS.includes(String(params.channel).toLowerCase()) ? String(params.channel).toLowerCase() : "search",
      budget: Math.max(0, mkNum(params.budget)),
      goal: mkClean(params.goal, 80).toLowerCase() || "conversions",
      startDate: mkDay(params.startDate) || mkDay(mkNow()),
      endDate: mkDay(params.endDate) || null,
      status: "active",
      createdAt: mkNow(),
    };
    mkListB(s.campaigns, mkAid(ctx)).push(campaign);
    saveMktState();
    return { ok: true, result: { campaign } };
  });

  registerLensAction("marketing", "campaign-list", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let campaigns = [...(s.campaigns.get(mkAid(ctx)) || [])];
    if (params.channel) campaigns = campaigns.filter((c) => c.channel === String(params.channel).toLowerCase());
    if (params.status) campaigns = campaigns.filter((c) => c.status === String(params.status).toLowerCase());
    campaigns = campaigns.map((c) => ({ ...c, kpis: computeKpis(s.metrics.get(c.id) || []) }));
    return { ok: true, result: { campaigns, count: campaigns.length } };
  });

  registerLensAction("marketing", "campaign-update", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findCampaign(s, mkAid(ctx), params.id);
    if (!c) return { ok: false, error: "campaign not found" };
    if (params.name != null) { const n = mkClean(params.name, 120); if (n) c.name = n; }
    if (params.budget != null) c.budget = Math.max(0, mkNum(params.budget));
    if (params.endDate != null) c.endDate = mkDay(params.endDate) || null;
    if (params.status != null && ["active", "paused", "completed", "draft"].includes(String(params.status).toLowerCase())) {
      c.status = String(params.status).toLowerCase();
    }
    saveMktState();
    return { ok: true, result: { campaign: c } };
  });

  registerLensAction("marketing", "campaign-delete", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.campaigns.get(mkAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "campaign not found" };
    arr.splice(i, 1);
    s.metrics.delete(params.id);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("marketing", "campaign-detail", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findCampaign(s, mkAid(ctx), params.id);
    if (!c) return { ok: false, error: "campaign not found" };
    const rows = s.metrics.get(c.id) || [];
    return { ok: true, result: { campaign: c, kpis: computeKpis(rows), metricDays: rows.length } };
  });

  // ── Metrics ─────────────────────────────────────────────────────────
  registerLensAction("marketing", "metric-log", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findCampaign(s, mkAid(ctx), params.campaignId);
    if (!c) return { ok: false, error: "campaign not found" };
    const date = mkDay(params.date) || mkDay(mkNow());
    const rows = mkListB(s.metrics, c.id);
    let row = rows.find((r) => r.date === date);
    if (!row) { row = { id: mkId("met"), campaignId: c.id, date }; rows.push(row); }
    row.impressions = Math.max(0, Math.round(mkNum(params.impressions, row.impressions)));
    row.clicks = Math.max(0, Math.round(mkNum(params.clicks, row.clicks)));
    row.conversions = Math.max(0, Math.round(mkNum(params.conversions, row.conversions)));
    row.spend = Math.max(0, Math.round(mkNum(params.spend, row.spend) * 100) / 100);
    row.revenue = Math.max(0, Math.round(mkNum(params.revenue, row.revenue) * 100) / 100);
    saveMktState();
    return { ok: true, result: { metric: row } };
  });

  registerLensAction("marketing", "metric-history", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findCampaign(s, mkAid(ctx), params.campaignId)) return { ok: false, error: "campaign not found" };
    const series = (s.metrics.get(String(params.campaignId)) || [])
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((r) => ({
        ...r,
        ctr: r.impressions > 0 ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0,
        roas: r.spend > 0 ? Math.round((r.revenue / r.spend) * 100) / 100 : 0,
      }));
    return { ok: true, result: { series, count: series.length } };
  });

  registerLensAction("marketing", "campaign-kpis", (ctx, _a, params = {}) => {
  try {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findCampaign(s, mkAid(ctx), params.campaignId);
    if (!c) return { ok: false, error: "campaign not found" };
    const kpis = computeKpis(s.metrics.get(c.id) || []);
    // benchmark verdict against 2026 norms (healthy ROAS 3-5x).
    let verdict = "no_data";
    if (kpis.spend > 0) {
      verdict = kpis.roas >= 4 ? "strong" : kpis.roas >= 2 ? "acceptable" : kpis.roas >= 1 ? "break_even" : "underperforming";
    }
    return { ok: true, result: { campaign: { id: c.id, name: c.name, channel: c.channel }, kpis, verdict } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Channel performance ─────────────────────────────────────────────
  registerLensAction("marketing", "channel-performance", (ctx, _a, _params = {}) => {
  try {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const byChannel = {};
    for (const c of s.campaigns.get(userId) || []) {
      if (!byChannel[c.channel]) byChannel[c.channel] = [];
      byChannel[c.channel].push(...(s.metrics.get(c.id) || []));
    }
    const channels = Object.entries(byChannel)
      .map(([channel, rows]) => ({ channel, campaigns: 0, kpis: computeKpis(rows) }))
      .sort((a, b) => b.kpis.roas - a.kpis.roas);
    for (const c of s.campaigns.get(userId) || []) {
      const ch = channels.find((x) => x.channel === c.channel);
      if (ch) ch.campaigns += 1;
    }
    return { ok: true, result: { channels, count: channels.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Leads ───────────────────────────────────────────────────────────
  registerLensAction("marketing", "lead-add", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "lead name required" };
    const lead = {
      id: mkId("lead"), name,
      email: mkClean(params.email, 160) || null,
      source: mkClean(params.source, 60).toLowerCase() || "direct",
      campaignId: params.campaignId ? String(params.campaignId) : null,
      value: Math.max(0, mkNum(params.value)),
      stage: "new", score: 0,
      createdAt: mkNow(),
    };
    mkListB(s.leads, mkAid(ctx)).push(lead);
    saveMktState();
    return { ok: true, result: { lead } };
  });

  registerLensAction("marketing", "lead-list", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let leads = [...(s.leads.get(mkAid(ctx)) || [])];
    if (params.stage) leads = leads.filter((l) => l.stage === String(params.stage).toLowerCase());
    leads.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
    const byStage = {};
    for (const st of LEAD_STAGES) byStage[st] = leads.filter((l) => l.stage === st).length;
    return { ok: true, result: { leads, count: leads.length, byStage } };
  });

  registerLensAction("marketing", "lead-update-stage", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lead = (s.leads.get(mkAid(ctx)) || []).find((l) => l.id === params.id);
    if (!lead) return { ok: false, error: "lead not found" };
    if (!LEAD_STAGES.includes(String(params.stage).toLowerCase())) {
      return { ok: false, error: `stage must be one of ${LEAD_STAGES.join("/")}` };
    }
    lead.stage = String(params.stage).toLowerCase();
    saveMktState();
    return { ok: true, result: { lead } };
  });

  registerLensAction("marketing", "lead-score", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lead = (s.leads.get(mkAid(ctx)) || []).find((l) => l.id === params.id);
    if (!lead) return { ok: false, error: "lead not found" };
    // weighted engagement model — bottom-funnel signals weigh most.
    const opens = mkNum(params.emailOpens);
    const clicks = mkNum(params.linkClicks);
    const pageViews = mkNum(params.pageViews);
    const formSubmits = mkNum(params.formSubmits);
    const raw = opens * 2 + clicks * 6 + pageViews * 3 + formSubmits * 20;
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    lead.score = score;
    lead.scoreSignals = { opens, clicks, pageViews, formSubmits };
    const grade = score >= 75 ? "A" : score >= 50 ? "B" : score >= 25 ? "C" : "D";
    saveMktState();
    return { ok: true, result: { leadId: lead.id, score, grade } };
  });

  registerLensAction("marketing", "lead-delete", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.leads.get(mkAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "lead not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Content calendar ────────────────────────────────────────────────
  registerLensAction("marketing", "content-add", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = mkClean(params.title, 160);
    if (!title) return { ok: false, error: "content title required" };
    const item = {
      id: mkId("cnt"), title,
      channel: CHANNELS.includes(String(params.channel).toLowerCase()) ? String(params.channel).toLowerCase() : "content",
      type: mkClean(params.type, 40).toLowerCase() || "post",
      scheduledDate: mkDay(params.scheduledDate) || null,
      status: "draft",
      createdAt: mkNow(),
    };
    mkListB(s.content, mkAid(ctx)).push(item);
    saveMktState();
    return { ok: true, result: { content: item } };
  });

  registerLensAction("marketing", "content-list", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let items = [...(s.content.get(mkAid(ctx)) || [])];
    if (params.status) items = items.filter((c) => c.status === String(params.status).toLowerCase());
    items.sort((a, b) => String(a.scheduledDate || "9999").localeCompare(String(b.scheduledDate || "9999")));
    return {
      ok: true,
      result: {
        content: items, count: items.length,
        scheduled: items.filter((c) => c.status === "scheduled").length,
        published: items.filter((c) => c.status === "published").length,
      },
    };
  });

  registerLensAction("marketing", "content-update-status", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = (s.content.get(mkAid(ctx)) || []).find((c) => c.id === params.id);
    if (!item) return { ok: false, error: "content not found" };
    if (!["draft", "scheduled", "published", "archived"].includes(String(params.status).toLowerCase())) {
      return { ok: false, error: "status must be draft/scheduled/published/archived" };
    }
    item.status = String(params.status).toLowerCase();
    saveMktState();
    return { ok: true, result: { content: item } };
  });

  registerLensAction("marketing", "content-delete", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.content.get(mkAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "content not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── A/B tests ───────────────────────────────────────────────────────
  registerLensAction("marketing", "abtest-create", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "test name required" };
    const test = {
      id: mkId("abt"), name,
      variantA: mkClean(params.variantA, 80) || "Variant A",
      variantB: mkClean(params.variantB, 80) || "Variant B",
      a: { visitors: 0, conversions: 0 },
      b: { visitors: 0, conversions: 0 },
      createdAt: mkNow(),
    };
    mkListB(s.abtests, mkAid(ctx)).push(test);
    saveMktState();
    return { ok: true, result: { test } };
  });

  registerLensAction("marketing", "abtest-record", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const test = (s.abtests.get(mkAid(ctx)) || []).find((t) => t.id === params.id);
    if (!test) return { ok: false, error: "test not found" };
    const variant = String(params.variant || "").toLowerCase();
    if (variant !== "a" && variant !== "b") return { ok: false, error: "variant must be 'a' or 'b'" };
    const slot = test[variant];
    slot.visitors += Math.max(0, Math.round(mkNum(params.visitors)));
    slot.conversions += Math.max(0, Math.round(mkNum(params.conversions)));
    saveMktState();
    return { ok: true, result: { test } };
  });

  function abtestView(t) {
    const rate = (v) => v.visitors > 0 ? Math.round((v.conversions / v.visitors) * 10000) / 100 : 0;
    const rA = rate(t.a), rB = rate(t.b);
    const decided = t.a.visitors > 0 && t.b.visitors > 0;
    let winner = null, lift = 0;
    if (decided && rA !== rB) {
      winner = rA > rB ? "a" : "b";
      const lo = Math.min(rA, rB), hi = Math.max(rA, rB);
      lift = lo > 0 ? Math.round(((hi - lo) / lo) * 1000) / 10 : 100;
    }
    return {
      id: t.id, name: t.name,
      variantA: { label: t.variantA, ...t.a, conversionRate: rA },
      variantB: { label: t.variantB, ...t.b, conversionRate: rB },
      winner, liftPct: lift,
    };
  }

  registerLensAction("marketing", "abtest-list", (ctx, _a, _params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tests = (s.abtests.get(mkAid(ctx)) || []).map(abtestView);
    return { ok: true, result: { tests, count: tests.length } };
  });

  registerLensAction("marketing", "abtest-delete", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.abtests.get(mkAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "test not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Attribution ─────────────────────────────────────────────────────
  registerLensAction("marketing", "attribution-report", (ctx, _a, _params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const campaignName = new Map((s.campaigns.get(userId) || []).map((c) => [c.id, c.name]));
    const wonLeads = (s.leads.get(userId) || []).filter((l) => l.stage === "won");
    const byCampaign = {};
    let unattributed = 0;
    for (const l of wonLeads) {
      if (l.campaignId && campaignName.has(l.campaignId)) {
        byCampaign[l.campaignId] = Math.round(((byCampaign[l.campaignId] || 0) + l.value) * 100) / 100;
      } else {
        unattributed = Math.round((unattributed + l.value) * 100) / 100;
      }
    }
    const attribution = Object.entries(byCampaign)
      .map(([campaignId, revenue]) => ({ campaignId, campaign: campaignName.get(campaignId) || "(removed)", revenue }))
      .sort((a, b) => b.revenue - a.revenue);
    return {
      ok: true,
      result: {
        attribution, unattributed,
        wonDeals: wonLeads.length,
        totalRevenue: Math.round(wonLeads.reduce((a, l) => a + l.value, 0) * 100) / 100,
      },
    };
  });

  // ── Audience segments ───────────────────────────────────────────────
  registerLensAction("marketing", "segment-create", (ctx, _a, params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "segment name required" };
    const segment = {
      id: mkId("seg"), name,
      criteria: mkClean(params.criteria, 300) || null,
      size: Math.max(0, Math.round(mkNum(params.size))),
      createdAt: mkNow(),
    };
    mkListB(s.segments, mkAid(ctx)).push(segment);
    saveMktState();
    return { ok: true, result: { segment } };
  });

  registerLensAction("marketing", "segment-list", (ctx, _a, _params = {}) => {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const segments = s.segments.get(mkAid(ctx)) || [];
    return {
      ok: true,
      result: { segments, totalReach: segments.reduce((a, x) => a + mkNum(x.size), 0) },
    };
  });

  // ── Budget pacing ───────────────────────────────────────────────────
  registerLensAction("marketing", "budget-pacing", (ctx, _a, params = {}) => {
  try {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findCampaign(s, mkAid(ctx), params.campaignId);
    if (!c) return { ok: false, error: "campaign not found" };
    const spent = computeKpis(s.metrics.get(c.id) || []).spend;
    const start = new Date(c.startDate + "T00:00:00Z").getTime();
    const end = c.endDate ? new Date(c.endDate + "T00:00:00Z").getTime() : start + 30 * 86400000;
    const now = Date.now();
    const totalDays = Math.max(1, Math.round((end - start) / 86400000));
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((now - start) / 86400000)));
    const expectedSpend = Math.round((c.budget * (elapsedDays / totalDays)) * 100) / 100;
    return {
      ok: true,
      result: {
        budget: c.budget, spent,
        remaining: Math.round((c.budget - spent) * 100) / 100,
        elapsedDays, totalDays,
        expectedSpend,
        pace: expectedSpend > 0
          ? (spent > expectedSpend * 1.1 ? "overpacing" : spent < expectedSpend * 0.9 ? "underpacing" : "on_track")
          : "not_started",
        utilisationPct: c.budget > 0 ? Math.round((spent / c.budget) * 100) : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  //  HubSpot-parity backlog: email builder + send engine, automation
  //  workflows, landing/form builder, social scheduler, lead-scoring
  //  model editor, SEO audit, CRM contact sync, campaign calendar.
  // ════════════════════════════════════════════════════════════════════

  // Extend the marketing STATE bucket with the new collections. getMktState
  // above only seeds the original six maps; add the rest lazily here.
  function getMktState2() {
    const s = getMktState();
    if (!s) return null;
    for (const k of [
      "emails", "emailSends", "workflows", "workflowRuns", "pages",
      "formSubmissions", "socialPosts", "scoringModels", "seoAudits", "contacts",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // ── Email builder + send engine ─────────────────────────────────────
  // An email is a block-based document. Sending is HONEST: with SMTP_*
  // configured it attempts real delivery via lib/email-service.js and
  // reports real delivered/failed counts; without a provider it records
  // the campaign as queued_no_provider and sends nothing. Open/click
  // engagement is NEVER synthesized — there are no tracking pixels, so
  // opened/clicked are reported as null (unknown), not invented rates.
  const EMAIL_BLOCK_TYPES = ["heading", "text", "image", "button", "divider", "spacer"];

  registerLensAction("marketing", "email-create", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "email name required" };
    const blocks = Array.isArray(params.blocks)
      ? params.blocks
          .filter((b) => b && EMAIL_BLOCK_TYPES.includes(String(b.type)))
          .map((b) => ({ type: String(b.type), content: mkClean(b.content, 2000) }))
      : [];
    const email = {
      id: mkId("eml"), name,
      subject: mkClean(params.subject, 200) || name,
      preheader: mkClean(params.preheader, 200) || null,
      fromName: mkClean(params.fromName, 80) || "Marketing",
      blocks,
      status: "draft",
      createdAt: mkNow(), updatedAt: mkNow(),
    };
    mkListB(s.emails, mkAid(ctx)).push(email);
    saveMktState();
    return { ok: true, result: { email } };
  });

  registerLensAction("marketing", "email-update", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = (s.emails.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!e) return { ok: false, error: "email not found" };
    if (params.name != null) { const n = mkClean(params.name, 120); if (n) e.name = n; }
    if (params.subject != null) e.subject = mkClean(params.subject, 200) || e.subject;
    if (params.preheader != null) e.preheader = mkClean(params.preheader, 200) || null;
    if (params.fromName != null) e.fromName = mkClean(params.fromName, 80) || e.fromName;
    if (Array.isArray(params.blocks)) {
      e.blocks = params.blocks
        .filter((b) => b && EMAIL_BLOCK_TYPES.includes(String(b.type)))
        .map((b) => ({ type: String(b.type), content: mkClean(b.content, 2000) }));
    }
    if (params.status != null && ["draft", "ready"].includes(String(params.status).toLowerCase())) {
      e.status = String(params.status).toLowerCase();
    }
    e.updatedAt = mkNow();
    saveMktState();
    return { ok: true, result: { email: e } };
  });

  registerLensAction("marketing", "email-list", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emails = (s.emails.get(mkAid(ctx)) || []).map((e) => {
      const sends = s.emailSends.get(e.id) || [];
      const sent = sends.length;
      const opened = sends.filter((x) => x.opened).length;
      const clicked = sends.filter((x) => x.clicked).length;
      return {
        ...e, blockCount: e.blocks.length,
        stats: {
          sent, opened, clicked,
          openRate: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
          clickRate: sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0,
        },
      };
    });
    return { ok: true, result: { emails, count: emails.length } };
  });

  registerLensAction("marketing", "email-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.emails.get(mkAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "email not found" };
    arr.splice(i, 1);
    s.emailSends.delete(params.id);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Deterministic 0..1 hash — no Math.random, so workflow branch
  // decisions are reproducible and testable. (No longer used to
  // fabricate email/social engagement — see email-send/social-publish.)
  function strHash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  // Honest delivery: attempts real SMTP delivery when a provider is
  // configured; otherwise records the campaign as queued and sends
  // NOTHING. Never fabricates opened/clicked — no tracking exists, so
  // engagement is null (unknown), not a synthesized rate.
  const EMAIL_SEND_MAX_RECIPIENTS = 500;
  registerLensAction("marketing", "email-send", async (ctx, _a, params = {}) => {
  try {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = (s.emails.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!e) return { ok: false, error: "email not found" };
    if (e.blocks.length === 0) return { ok: false, error: "add at least one content block before sending" };
    const recipients = Array.isArray(params.recipients)
      ? params.recipients.map((r) => mkClean(r, 160)).filter(Boolean)
      : [];
    if (recipients.length === 0) return { ok: false, error: "at least one recipient required" };
    const at = mkNow();

    if (!process.env.SMTP_HOST) {
      // No email provider configured — do NOT pretend delivery happened
      // and do NOT synthesize analytics. Persist the campaign record
      // with an honest status and report exactly what occurred: nothing.
      e.status = "queued_no_provider";
      e.lastQueuedAt = at;
      e.lastQueueAttempt = { at, recipients: recipients.length, status: "queued_no_provider" };
      saveMktState();
      return {
        ok: true,
        result: {
          emailId: e.id,
          status: "queued_no_provider",
          recipients: recipients.length,
          delivered: 0,
          opened: null,
          clicked: null,
          note: "No email provider configured — campaign recorded, nothing was sent. Set SMTP_* to enable delivery.",
        },
      };
    }

    // SMTP configured — attempt real delivery per recipient (bounded).
    const { sendEmail } = await import("../lib/email-service.js");
    const batch = recipients.slice(0, EMAIL_SEND_MAX_RECIPIENTS);
    const skipped = recipients.length - batch.length;
    const text = e.blocks.map((b) => b.content).filter(Boolean).join("\n\n");
    const sends = mkListB(s.emailSends, e.id);
    let delivered = 0, failed = 0;
    const failures = [];
    for (const to of batch) {
      try {
        const r = await sendEmail({ to, subject: e.subject, text });
        if (r && r.ok) {
          delivered++;
          // opened/clicked are unknown (no tracking pixels) — stored as
          // null so downstream stats count them as 0, never as invented.
          sends.push({ id: mkId("snd"), to, sentAt: at, opened: null, clicked: null });
        } else {
          failed++;
          failures.push({ to, error: String(r?.error || "send failed") });
        }
      } catch (err) {
        failed++;
        failures.push({ to, error: String(err?.message || err) });
      }
    }
    e.status = "sent";
    e.lastSentAt = at;
    saveMktState();
    return {
      ok: true,
      result: {
        emailId: e.id,
        status: "sent",
        recipients: batch.length,
        delivered,
        failed,
        ...(skipped > 0 ? { skipped } : {}),
        ...(failures.length > 0 ? { failures: failures.slice(0, 20) } : {}),
        opened: null,
        clicked: null,
        note: "engagement tracking not implemented",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Marketing automation workflows ──────────────────────────────────
  // A workflow is an ordered list of trigger → delay → email → branch
  // steps. Enrolling a contact walks the steps and records a run.
  const WORKFLOW_STEP_TYPES = ["trigger", "delay", "send_email", "branch", "tag", "goal"];

  registerLensAction("marketing", "workflow-create", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "workflow name required" };
    const steps = Array.isArray(params.steps)
      ? params.steps
          .filter((st) => st && WORKFLOW_STEP_TYPES.includes(String(st.type)))
          .map((st) => ({
            type: String(st.type),
            label: mkClean(st.label, 120) || String(st.type),
            delayHours: st.type === "delay" ? Math.max(0, Math.round(mkNum(st.delayHours))) : 0,
            emailId: st.type === "send_email" ? (st.emailId ? String(st.emailId) : null) : null,
            condition: st.type === "branch" ? mkClean(st.condition, 200) || null : null,
          }))
      : [];
    const workflow = {
      id: mkId("wfl"), name,
      description: mkClean(params.description, 300) || null,
      triggerType: mkClean(params.triggerType, 60).toLowerCase() || "form_submission",
      steps, status: "draft",
      enrolled: 0, completed: 0,
      createdAt: mkNow(),
    };
    mkListB(s.workflows, mkAid(ctx)).push(workflow);
    saveMktState();
    return { ok: true, result: { workflow } };
  });

  registerLensAction("marketing", "workflow-update", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = (s.workflows.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!w) return { ok: false, error: "workflow not found" };
    if (params.name != null) { const n = mkClean(params.name, 120); if (n) w.name = n; }
    if (params.description != null) w.description = mkClean(params.description, 300) || null;
    if (Array.isArray(params.steps)) {
      w.steps = params.steps
        .filter((st) => st && WORKFLOW_STEP_TYPES.includes(String(st.type)))
        .map((st) => ({
          type: String(st.type),
          label: mkClean(st.label, 120) || String(st.type),
          delayHours: st.type === "delay" ? Math.max(0, Math.round(mkNum(st.delayHours))) : 0,
          emailId: st.type === "send_email" ? (st.emailId ? String(st.emailId) : null) : null,
          condition: st.type === "branch" ? mkClean(st.condition, 200) || null : null,
        }));
    }
    if (params.status != null && ["draft", "active", "paused"].includes(String(params.status).toLowerCase())) {
      w.status = String(params.status).toLowerCase();
    }
    saveMktState();
    return { ok: true, result: { workflow: w } };
  });

  registerLensAction("marketing", "workflow-list", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const workflows = (s.workflows.get(mkAid(ctx)) || []).map((w) => ({
      ...w, stepCount: w.steps.length,
      completionRate: w.enrolled > 0 ? Math.round((w.completed / w.enrolled) * 1000) / 10 : 0,
    }));
    return { ok: true, result: { workflows, count: workflows.length } };
  });

  registerLensAction("marketing", "workflow-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.workflows.get(mkAid(ctx)) || [];
    const i = arr.findIndex((w) => w.id === params.id);
    if (i < 0) return { ok: false, error: "workflow not found" };
    arr.splice(i, 1);
    s.workflowRuns.delete(params.id);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Enroll a contact and simulate the run: walk steps, accumulate the
  // delay timeline, branch deterministically, emit a per-step trace.
  registerLensAction("marketing", "workflow-enroll", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = (s.workflows.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!w) return { ok: false, error: "workflow not found" };
    if (w.status !== "active") return { ok: false, error: "activate the workflow before enrolling" };
    const contact = mkClean(params.contact, 160);
    if (!contact) return { ok: false, error: "contact required" };
    let cursorHours = 0;
    let reachedGoal = false;
    const trace = [];
    for (const st of w.steps) {
      if (st.type === "delay") { cursorHours += st.delayHours; trace.push({ type: "delay", label: st.label, atHour: cursorHours }); continue; }
      if (st.type === "branch") {
        const taken = strHash01(w.id + "|" + contact + "|" + st.label) < 0.5;
        trace.push({ type: "branch", label: st.label, atHour: cursorHours, branch: taken ? "yes" : "no" });
        if (!taken) break;
        continue;
      }
      if (st.type === "goal") { reachedGoal = true; trace.push({ type: "goal", label: st.label, atHour: cursorHours }); break; }
      trace.push({ type: st.type, label: st.label, atHour: cursorHours });
    }
    const run = {
      id: mkId("wfr"), workflowId: w.id, contact,
      enrolledAt: mkNow(), durationHours: cursorHours,
      reachedGoal, stepsRun: trace.length, trace,
    };
    mkListB(s.workflowRuns, w.id).push(run);
    w.enrolled += 1;
    if (reachedGoal) w.completed += 1;
    saveMktState();
    return { ok: true, result: { run } };
  });

  registerLensAction("marketing", "workflow-runs", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.workflows.get(mkAid(ctx)) || []).some((w) => w.id === params.id)) {
      return { ok: false, error: "workflow not found" };
    }
    const runs = (s.workflowRuns.get(String(params.id)) || []).slice().reverse();
    return { ok: true, result: { runs, count: runs.length } };
  });

  // ── Landing page / form builder + submission capture ────────────────
  const FORM_FIELD_TYPES = ["text", "email", "phone", "select", "textarea", "checkbox"];

  registerLensAction("marketing", "page-create", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "page name required" };
    const slug = (mkClean(params.slug, 80) || name)
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
    const fields = Array.isArray(params.fields)
      ? params.fields
          .filter((f) => f && FORM_FIELD_TYPES.includes(String(f.type)))
          .map((f) => ({
            type: String(f.type),
            label: mkClean(f.label, 80) || String(f.type),
            required: !!f.required,
            options: Array.isArray(f.options) ? f.options.map((o) => mkClean(o, 60)).filter(Boolean) : [],
          }))
      : [];
    const page = {
      id: mkId("pag"), name, slug,
      headline: mkClean(params.headline, 200) || name,
      subhead: mkClean(params.subhead, 400) || null,
      ctaText: mkClean(params.ctaText, 60) || "Submit",
      fields, status: "draft",
      views: 0,
      createdAt: mkNow(),
    };
    mkListB(s.pages, mkAid(ctx)).push(page);
    saveMktState();
    return { ok: true, result: { page } };
  });

  registerLensAction("marketing", "page-update", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = (s.pages.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!p) return { ok: false, error: "page not found" };
    if (params.name != null) { const n = mkClean(params.name, 120); if (n) p.name = n; }
    if (params.headline != null) p.headline = mkClean(params.headline, 200) || p.headline;
    if (params.subhead != null) p.subhead = mkClean(params.subhead, 400) || null;
    if (params.ctaText != null) p.ctaText = mkClean(params.ctaText, 60) || p.ctaText;
    if (Array.isArray(params.fields)) {
      p.fields = params.fields
        .filter((f) => f && FORM_FIELD_TYPES.includes(String(f.type)))
        .map((f) => ({
          type: String(f.type),
          label: mkClean(f.label, 80) || String(f.type),
          required: !!f.required,
          options: Array.isArray(f.options) ? f.options.map((o) => mkClean(o, 60)).filter(Boolean) : [],
        }));
    }
    if (params.status != null && ["draft", "published", "archived"].includes(String(params.status).toLowerCase())) {
      p.status = String(params.status).toLowerCase();
    }
    saveMktState();
    return { ok: true, result: { page: p } };
  });

  registerLensAction("marketing", "page-list", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = (s.pages.get(mkAid(ctx)) || []).map((p) => {
      const subs = (s.formSubmissions.get(p.id) || []).length;
      return {
        ...p, fieldCount: p.fields.length, submissions: subs,
        conversionRate: p.views > 0 ? Math.round((subs / p.views) * 1000) / 10 : 0,
      };
    });
    return { ok: true, result: { pages, count: pages.length } };
  });

  registerLensAction("marketing", "page-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.pages.get(mkAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "page not found" };
    arr.splice(i, 1);
    s.formSubmissions.delete(params.id);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Capture a form submission. A submission also becomes a lead so the
  // landing page feeds the pipeline — that's HubSpot's whole point.
  registerLensAction("marketing", "page-submit", (ctx, _a, params = {}) => {
  try {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = (s.pages.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!p) return { ok: false, error: "page not found" };
    if (p.status !== "published") return { ok: false, error: "publish the page before capturing submissions" };
    const values = (params.values && typeof params.values === "object") ? params.values : {};
    const clean = {};
    for (const f of p.fields) {
      const v = mkClean(values[f.label], 400);
      if (f.required && !v) return { ok: false, error: `field "${f.label}" is required` };
      clean[f.label] = v;
    }
    const submission = {
      id: mkId("sub"), pageId: p.id, values: clean, submittedAt: mkNow(),
    };
    mkListB(s.formSubmissions, p.id).push(submission);
    // mirror into the leads pipeline
    const emailKey = Object.entries(clean).find(([k]) => /email/i.test(k));
    const nameKey = Object.entries(clean).find(([k]) => /name/i.test(k));
    const lead = {
      id: mkId("lead"),
      name: (nameKey && nameKey[1]) || (emailKey && emailKey[1]) || `Submission ${submission.id.slice(-6)}`,
      email: (emailKey && emailKey[1]) || null,
      source: "landing_page",
      campaignId: null, value: 0, stage: "new", score: 0,
      createdAt: mkNow(),
    };
    mkListB(s.leads, mkAid(ctx)).push(lead);
    saveMktState();
    return { ok: true, result: { submission, leadId: lead.id } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("marketing", "page-submissions", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.pages.get(mkAid(ctx)) || []).some((p) => p.id === params.id)) {
      return { ok: false, error: "page not found" };
    }
    const submissions = (s.formSubmissions.get(String(params.id)) || []).slice().reverse();
    return { ok: true, result: { submissions, count: submissions.length } };
  });

  // ── Social media scheduler ──────────────────────────────────────────
  const SOCIAL_CHANNELS = ["twitter", "linkedin", "facebook", "instagram", "tiktok", "youtube", "pinterest"];

  registerLensAction("marketing", "social-schedule", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const body = mkClean(params.body, 1000);
    if (!body) return { ok: false, error: "post body required" };
    const channels = Array.isArray(params.channels)
      ? [...new Set(params.channels.map((c) => String(c).toLowerCase()).filter((c) => SOCIAL_CHANNELS.includes(c)))]
      : [];
    if (channels.length === 0) return { ok: false, error: "select at least one valid channel" };
    const post = {
      id: mkId("soc"), body, channels,
      scheduledAt: mkClean(params.scheduledAt, 30) || mkNow(),
      link: mkClean(params.link, 300) || null,
      status: "scheduled",
      createdAt: mkNow(),
    };
    mkListB(s.socialPosts, mkAid(ctx)).push(post);
    saveMktState();
    return { ok: true, result: { post } };
  });

  registerLensAction("marketing", "social-list", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    let posts = [...(s.socialPosts.get(mkAid(ctx)) || [])];
    if (params.status) posts = posts.filter((p) => p.status === String(params.status).toLowerCase());
    posts.sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
    return {
      ok: true,
      result: {
        posts, count: posts.length,
        scheduled: posts.filter((p) => p.status === "scheduled").length,
        published: posts.filter((p) => p.status === "published").length,
      },
    };
  });

  // Honest publish: no social provider integration exists, so nothing
  // can actually be posted to Twitter/LinkedIn/etc. The post is saved
  // as a draft and the API says so. Impressions/engagements are never
  // fabricated — they are null until a real provider reports them.
  registerLensAction("marketing", "social-publish", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = (s.socialPosts.get(mkAid(ctx)) || []).find((x) => x.id === params.id);
    if (!p) return { ok: false, error: "post not found" };
    if (p.status === "published") return { ok: false, error: "post already published" };
    p.status = "draft";
    p.draftSavedAt = mkNow();
    saveMktState();
    return {
      ok: true,
      result: {
        status: "draft_saved",
        note: "No social provider connected — post saved as draft, not published. Connect a provider to publish.",
        impressions: null,
        engagements: null,
        post: p,
      },
    };
  });

  registerLensAction("marketing", "social-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.socialPosts.get(mkAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "post not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Lead scoring model editor ───────────────────────────────────────
  // Configurable rule set. Each rule maps an attribute/behaviour signal
  // to a point value. Applying the model to a lead computes a real score.
  registerLensAction("marketing", "scoring-model-save", (ctx, _a, params = {}) => {
  try {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mkClean(params.name, 120);
    if (!name) return { ok: false, error: "model name required" };
    const rules = Array.isArray(params.rules)
      ? params.rules
          .map((r) => ({
            signal: mkClean(r.signal, 60),
            points: Math.round(mkNum(r.points)),
          }))
          .filter((r) => r.signal && Number.isFinite(r.points))
      : [];
    if (rules.length === 0) return { ok: false, error: "add at least one scoring rule" };
    const userId = mkAid(ctx);
    const existing = params.id ? (s.scoringModels.get(userId) || []).find((m) => m.id === params.id) : null;
    if (existing) {
      existing.name = name;
      existing.rules = rules;
      existing.threshold = Math.max(0, Math.round(mkNum(params.threshold, existing.threshold)));
      existing.updatedAt = mkNow();
      saveMktState();
      return { ok: true, result: { model: existing } };
    }
    const model = {
      id: mkId("scm"), name, rules,
      threshold: Math.max(0, Math.round(mkNum(params.threshold, 50))),
      createdAt: mkNow(), updatedAt: mkNow(),
    };
    mkListB(s.scoringModels, userId).push(model);
    saveMktState();
    return { ok: true, result: { model } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("marketing", "scoring-model-list", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const models = (s.scoringModels.get(mkAid(ctx)) || []).map((m) => ({
      ...m, ruleCount: m.rules.length,
      maxScore: m.rules.reduce((a, r) => a + Math.max(0, r.points), 0),
    }));
    return { ok: true, result: { models, count: models.length } };
  });

  registerLensAction("marketing", "scoring-model-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.scoringModels.get(mkAid(ctx)) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "model not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Apply a model: signals is { signalName: count }. Score = Σ count×points.
  registerLensAction("marketing", "scoring-model-apply", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const model = (s.scoringModels.get(userId) || []).find((m) => m.id === params.modelId);
    if (!model) return { ok: false, error: "scoring model not found" };
    const lead = (s.leads.get(userId) || []).find((l) => l.id === params.leadId);
    if (!lead) return { ok: false, error: "lead not found" };
    const signals = (params.signals && typeof params.signals === "object") ? params.signals : {};
    const breakdown = [];
    let total = 0;
    for (const rule of model.rules) {
      const count = Math.max(0, mkNum(signals[rule.signal]));
      const contributed = count * rule.points;
      if (count > 0) breakdown.push({ signal: rule.signal, count, points: rule.points, contributed });
      total += contributed;
    }
    const score = Math.max(0, Math.min(100, Math.round(total)));
    lead.score = score;
    lead.scoredBy = model.id;
    const qualified = score >= model.threshold;
    const grade = score >= 75 ? "A" : score >= 50 ? "B" : score >= 25 ? "C" : "D";
    saveMktState();
    return {
      ok: true,
      result: { leadId: lead.id, modelId: model.id, score, grade, qualified, threshold: model.threshold, breakdown },
    };
  });

  // ── SEO audit tooling ───────────────────────────────────────────────
  // On-page analysis from real text inputs — title length, meta length,
  // word count, keyword density, heading/image checks — plus a score.
  registerLensAction("marketing", "seo-audit", (ctx, _a, params = {}) => {
  try {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const url = mkClean(params.url, 300);
    if (!url) return { ok: false, error: "page url required" };
    const title = mkClean(params.title, 300);
    const metaDescription = mkClean(params.metaDescription, 500);
    const bodyText = String(params.bodyText == null ? "" : params.bodyText).trim();
    const keyword = mkClean(params.keyword, 80).toLowerCase();
    const headings = Math.max(0, Math.round(mkNum(params.headingCount)));
    const images = Math.max(0, Math.round(mkNum(params.imageCount)));
    const imagesWithAlt = Math.min(images, Math.max(0, Math.round(mkNum(params.imagesWithAlt))));
    const words = bodyText ? bodyText.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;
    let keywordCount = 0;
    if (keyword) {
      const k = keyword.toLowerCase();
      keywordCount = words.filter((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "") === k).length;
    }
    const keywordDensity = wordCount > 0 ? Math.round((keywordCount / wordCount) * 10000) / 100 : 0;

    const checks = [];
    const addCheck = (label, pass, hint) => checks.push({ label, pass, hint: pass ? null : hint });
    addCheck("Title length 30–60 chars", title.length >= 30 && title.length <= 60,
      `Title is ${title.length} chars — aim for 30–60.`);
    addCheck("Meta description 70–160 chars", metaDescription.length >= 70 && metaDescription.length <= 160,
      `Meta description is ${metaDescription.length} chars — aim for 70–160.`);
    addCheck("Body content ≥ 300 words", wordCount >= 300,
      `Only ${wordCount} words — thin content ranks poorly.`);
    addCheck("Keyword in title", !!keyword && title.toLowerCase().includes(keyword),
      keyword ? `Target keyword "${keyword}" missing from the title.` : "No target keyword provided.");
    addCheck("Keyword density 0.5–2.5%", keywordDensity >= 0.5 && keywordDensity <= 2.5,
      keywordDensity > 2.5 ? `Density ${keywordDensity}% — risks keyword stuffing.` : `Density ${keywordDensity}% — too low.`);
    addCheck("At least one heading", headings >= 1, "Add an H1/H2 heading structure.");
    addCheck("All images have alt text", images === 0 || imagesWithAlt === images,
      `${images - imagesWithAlt} of ${images} images missing alt text.`);

    const passed = checks.filter((c) => c.pass).length;
    const score = Math.round((passed / checks.length) * 100);
    const audit = {
      id: mkId("seo"), url, keyword: keyword || null,
      title, titleLength: title.length,
      metaLength: metaDescription.length, wordCount,
      keywordCount, keywordDensity, headings, images, imagesWithAlt,
      checks, passed, total: checks.length, score,
      grade: score >= 85 ? "excellent" : score >= 65 ? "good" : score >= 40 ? "needs work" : "poor",
      auditedAt: mkNow(),
    };
    mkListB(s.seoAudits, mkAid(ctx)).push(audit);
    saveMktState();
    return { ok: true, result: { audit } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("marketing", "seo-audit-list", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const audits = (s.seoAudits.get(mkAid(ctx)) || []).slice().reverse();
    return {
      ok: true,
      result: {
        audits, count: audits.length,
        avgScore: audits.length > 0
          ? Math.round(audits.reduce((a, x) => a + x.score, 0) / audits.length)
          : 0,
      },
    };
  });

  registerLensAction("marketing", "seo-audit-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.seoAudits.get(mkAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "audit not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── CRM contact sync ────────────────────────────────────────────────
  // A contacts book that syncs bidirectionally with the leads pipeline.
  registerLensAction("marketing", "contact-upsert", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const email = mkClean(params.email, 160).toLowerCase();
    if (!email) return { ok: false, error: "contact email required" };
    const list = mkListB(s.contacts, userId);
    let contact = list.find((c) => c.email === email);
    if (!contact) {
      contact = { id: mkId("ctc"), email, createdAt: mkNow() };
      list.push(contact);
    }
    if (params.name != null) contact.name = mkClean(params.name, 120) || contact.name || email;
    else if (!contact.name) contact.name = email;
    if (params.company != null) contact.company = mkClean(params.company, 120) || null;
    if (params.phone != null) contact.phone = mkClean(params.phone, 40) || null;
    if (params.lifecycleStage != null) {
      contact.lifecycleStage = mkClean(params.lifecycleStage, 40).toLowerCase() || "subscriber";
    } else if (!contact.lifecycleStage) {
      contact.lifecycleStage = "subscriber";
    }
    contact.updatedAt = mkNow();
    saveMktState();
    return { ok: true, result: { contact } };
  });

  registerLensAction("marketing", "contact-list", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    let contacts = [...(s.contacts.get(mkAid(ctx)) || [])];
    if (params.lifecycleStage) {
      contacts = contacts.filter((c) => c.lifecycleStage === String(params.lifecycleStage).toLowerCase());
    }
    if (params.query) {
      const q = String(params.query).toLowerCase();
      contacts = contacts.filter((c) =>
        (c.name || "").toLowerCase().includes(q) || c.email.includes(q) || (c.company || "").toLowerCase().includes(q));
    }
    contacts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { ok: true, result: { contacts, count: contacts.length } };
  });

  registerLensAction("marketing", "contact-delete", (ctx, _a, params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.contacts.get(mkAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "contact not found" };
    arr.splice(i, 1);
    saveMktState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Bidirectional sync: pull every lead with an email into the contacts
  // book (lead→contact) and push contacts not yet leads back as leads.
  registerLensAction("marketing", "contact-sync", (ctx, _a, _params = {}) => {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const contacts = mkListB(s.contacts, userId);
    const leads = mkListB(s.leads, userId);
    const contactByEmail = new Map(contacts.map((c) => [c.email, c]));
    const leadByEmail = new Map(leads.filter((l) => l.email).map((l) => [String(l.email).toLowerCase(), l]));
    let importedFromLeads = 0, exportedToLeads = 0;
    // lead → contact
    for (const l of leads) {
      if (!l.email) continue;
      const email = String(l.email).toLowerCase();
      if (!contactByEmail.has(email)) {
        const c = {
          id: mkId("ctc"), email, name: l.name || email,
          company: null, phone: null,
          lifecycleStage: l.stage === "won" ? "customer" : "lead",
          createdAt: mkNow(), updatedAt: mkNow(),
        };
        contacts.push(c);
        contactByEmail.set(email, c);
        importedFromLeads++;
      }
    }
    // contact → lead
    for (const c of contacts) {
      if (!leadByEmail.has(c.email)) {
        leads.push({
          id: mkId("lead"), name: c.name || c.email, email: c.email,
          source: "crm_sync", campaignId: null, value: 0, stage: "new", score: 0,
          createdAt: mkNow(),
        });
        exportedToLeads++;
      }
    }
    saveMktState();
    return {
      ok: true,
      result: {
        importedFromLeads, exportedToLeads,
        totalContacts: contacts.length, totalLeads: leads.length,
      },
    };
  });

  // ── Campaign calendar ───────────────────────────────────────────────
  // Unified scheduling view: campaigns, content, social posts and sent
  // emails collapsed onto a single date-keyed timeline.
  registerLensAction("marketing", "campaign-calendar", (ctx, _a, params = {}) => {
  try {
    const s = getMktState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const from = mkDay(params.from) || null;
    const to = mkDay(params.to) || null;
    const inRange = (d) => {
      if (!d) return false;
      const day = String(d).slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    };
    const entries = [];
    for (const c of s.campaigns.get(userId) || []) {
      if (inRange(c.startDate)) entries.push({ kind: "campaign", id: c.id, title: c.name, date: c.startDate, channel: c.channel, marker: "start" });
      if (c.endDate && inRange(c.endDate)) entries.push({ kind: "campaign", id: c.id, title: c.name, date: c.endDate, channel: c.channel, marker: "end" });
    }
    for (const c of s.content.get(userId) || []) {
      if (inRange(c.scheduledDate)) entries.push({ kind: "content", id: c.id, title: c.title, date: c.scheduledDate, channel: c.channel, marker: c.status });
    }
    for (const p of s.socialPosts.get(userId) || []) {
      const day = String(p.scheduledAt || "").slice(0, 10);
      if (inRange(day)) entries.push({ kind: "social", id: p.id, title: p.body.slice(0, 60), date: day, channel: p.channels.join(", "), marker: p.status });
    }
    for (const e of s.emails.get(userId) || []) {
      if (e.lastSentAt) {
        const day = String(e.lastSentAt).slice(0, 10);
        if (inRange(day)) entries.push({ kind: "email", id: e.id, title: e.name, date: day, channel: "email", marker: "sent" });
      }
    }
    entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const byDate = {};
    for (const e of entries) { (byDate[e.date] = byDate[e.date] || []).push(e); }
    return {
      ok: true,
      result: {
        entries, count: entries.length, byDate,
        days: Object.keys(byDate).sort(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("marketing", "marketing-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getMktState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mkAid(ctx);
    const campaigns = s.campaigns.get(userId) || [];
    const allMetrics = [];
    for (const c of campaigns) allMetrics.push(...(s.metrics.get(c.id) || []));
    const kpis = computeKpis(allMetrics);
    const leads = s.leads.get(userId) || [];
    return {
      ok: true,
      result: {
        campaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.status === "active").length,
        totalSpend: kpis.spend,
        totalRevenue: kpis.revenue,
        blendedRoas: kpis.roas,
        leads: leads.length,
        qualifiedLeads: leads.filter((l) => ["qualified", "opportunity", "won"].includes(l.stage)).length,
        wonDeals: leads.filter((l) => l.stage === "won").length,
        scheduledContent: (s.content.get(userId) || []).filter((c) => c.status === "scheduled").length,
        abTests: (s.abtests.get(userId) || []).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
