// server/domains/marketing.js
export default function registerMarketingActions(registerLensAction) {
  registerLensAction("marketing", "campaignROI", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const spend = parseFloat(data.spend) || 0;
    const revenue = parseFloat(data.revenue) || 0;
    const leads = parseInt(data.leads) || 0;
    const conversions = parseInt(data.conversions) || 0;
    const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
    const cpl = leads > 0 ? Math.round(spend / leads * 100) / 100 : 0;
    const cpa = conversions > 0 ? Math.round(spend / conversions * 100) / 100 : 0;
    const convRate = leads > 0 ? Math.round((conversions / leads) * 100) : 0;
    return { ok: true, result: { campaign: data.name || artifact.title, spend, revenue, roi, leads, conversions, costPerLead: cpl, costPerAcquisition: cpa, conversionRate: convRate, profitable: roi > 0, grade: roi > 200 ? "exceptional" : roi > 100 ? "strong" : roi > 0 ? "positive" : "negative" } };
  });
  registerLensAction("marketing", "abTestAnalysis", (ctx, artifact, _params) => {
    const variants = artifact.data?.variants || [];
    if (variants.length < 2) return { ok: true, result: { message: "Add at least 2 variants with visitors and conversions." } };
    const analyzed = variants.map(v => { const visitors = parseInt(v.visitors) || 1; const conversions = parseInt(v.conversions) || 0; return { name: v.name, visitors, conversions, conversionRate: Math.round((conversions / visitors) * 10000) / 100 }; });
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
    const analyzed = stages.map((s, i) => { const count = parseInt(s.count) || 0; const prev = i > 0 ? (parseInt(stages[i-1].count) || 1) : count; return { stage: s.name, visitors: count, dropoff: i > 0 ? Math.round((1 - count / prev) * 100) : 0, convFromTop: parseInt(stages[0].count) > 0 ? Math.round((count / parseInt(stages[0].count)) * 100) : 0 }; });
    const worstDropoff = analyzed.slice(1).sort((a, b) => b.dropoff - a.dropoff)[0];
    return { ok: true, result: { stages: analyzed, overallConversion: analyzed[analyzed.length - 1]?.convFromTop || 0, biggestLeakage: worstDropoff?.stage, leakageRate: worstDropoff?.dropoff, quickWin: worstDropoff ? `Improving ${worstDropoff.stage} could recover ${worstDropoff.dropoff}% of visitors` : "Funnel is healthy" } };
  });
  registerLensAction("marketing", "audienceSegment", (ctx, artifact, _params) => {
    const users = artifact.data?.users || [];
    if (users.length === 0) return { ok: true, result: { message: "Add user data to segment audience." } };
    const segments = {};
    for (const u of users) { const seg = u.segment || u.tier || "general"; if (!segments[seg]) segments[seg] = { count: 0, totalSpend: 0 }; segments[seg].count++; segments[seg].totalSpend += parseFloat(u.spend || u.ltv) || 0; }
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
  });

  // ── Channel performance ─────────────────────────────────────────────
  registerLensAction("marketing", "channel-performance", (ctx, _a, _params = {}) => {
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
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("marketing", "marketing-dashboard", (ctx, _a, _params = {}) => {
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
  });
}
