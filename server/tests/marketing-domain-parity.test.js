// Contract tests for the marketing HubSpot + marketing-dashboard
// 2026-parity macros (campaigns, metrics, KPIs, leads, content,
// A/B tests, attribution, segments). Compute macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketingActions from "../domains/marketing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`marketing.${name}`);
  assert.ok(fn, `marketing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newCampaign(ctx = ctxA, over = {}) {
  return call("campaign-create", ctx, { name: "Q3 Search", channel: "search", budget: 10000, ...over }).result.campaign;
}

describe("marketing.campaign-* + KPIs", () => {
  it("create requires a name, scoped per user", () => {
    assert.equal(call("campaign-create", ctxA, {}).ok, false);
    newCampaign();
    assert.equal(call("campaign-list", ctxA, {}).result.count, 1);
    assert.equal(call("campaign-list", ctxB, {}).result.count, 0);
  });

  it("metrics roll into real CTR / CPC / ROAS", () => {
    const c = newCampaign();
    call("metric-log", ctxA, { campaignId: c.id, date: "2026-05-10", impressions: 10000, clicks: 400, conversions: 40, spend: 800, revenue: 4000 });
    const k = call("campaign-kpis", ctxA, { campaignId: c.id }).result;
    assert.equal(k.kpis.ctr, 4);          // 400/10000
    assert.equal(k.kpis.cpc, 2);          // 800/400
    assert.equal(k.kpis.cpa, 20);         // 800/40
    assert.equal(k.kpis.roas, 5);         // 4000/800
    assert.equal(k.kpis.conversionRate, 10);
    assert.equal(k.verdict, "strong");
  });

  it("metric-log upserts by date, history is sorted", () => {
    const c = newCampaign();
    call("metric-log", ctxA, { campaignId: c.id, date: "2026-05-02", clicks: 10, impressions: 100 });
    call("metric-log", ctxA, { campaignId: c.id, date: "2026-05-01", clicks: 5, impressions: 100 });
    call("metric-log", ctxA, { campaignId: c.id, date: "2026-05-02", clicks: 20, impressions: 200 });
    const h = call("metric-history", ctxA, { campaignId: c.id });
    assert.equal(h.result.count, 2);
    assert.equal(h.result.series[0].date, "2026-05-01");
    assert.equal(h.result.series[1].clicks, 20); // upserted
  });

  it("update + delete", () => {
    const c = newCampaign();
    assert.equal(call("campaign-update", ctxA, { id: c.id, status: "paused" }).result.campaign.status, "paused");
    assert.equal(call("campaign-delete", ctxA, { id: c.id }).ok, true);
    assert.equal(call("campaign-list", ctxA, {}).result.count, 0);
  });
});

describe("marketing.channel-performance", () => {
  it("aggregates KPIs by channel", () => {
    const search = newCampaign(ctxA, { channel: "search" });
    const social = newCampaign(ctxA, { channel: "social" });
    call("metric-log", ctxA, { campaignId: search.id, date: "2026-05-01", spend: 100, revenue: 500 });
    call("metric-log", ctxA, { campaignId: social.id, date: "2026-05-01", spend: 100, revenue: 200 });
    const cp = call("channel-performance", ctxA, {});
    assert.equal(cp.result.channels[0].channel, "search"); // higher ROAS
    assert.equal(cp.result.channels[0].kpis.roas, 5);
  });
});

describe("marketing.leads", () => {
  it("add, score, stage, attribution", () => {
    const c = newCampaign();
    const lead = call("lead-add", ctxA, { name: "Acme Corp", campaignId: c.id, value: 5000 }).result.lead;
    const sc = call("lead-score", ctxA, { id: lead.id, emailOpens: 5, linkClicks: 4, formSubmits: 2 });
    assert.equal(sc.result.score, 5 * 2 + 4 * 6 + 2 * 20); // 74
    assert.equal(sc.result.grade, "B");
    call("lead-update-stage", ctxA, { id: lead.id, stage: "won" });
    const attr = call("attribution-report", ctxA, {});
    assert.equal(attr.result.totalRevenue, 5000);
    assert.equal(attr.result.attribution[0].revenue, 5000);
  });

  it("rejects a bad stage", () => {
    const lead = call("lead-add", ctxA, { name: "L" }).result.lead;
    assert.equal(call("lead-update-stage", ctxA, { id: lead.id, stage: "bogus" }).ok, false);
  });
});

describe("marketing.content calendar", () => {
  it("add, status flow, list counts", () => {
    const item = call("content-add", ctxA, { title: "Launch blog", channel: "content" }).result.content;
    call("content-update-status", ctxA, { id: item.id, status: "scheduled" });
    const list = call("content-list", ctxA, {});
    assert.equal(list.result.scheduled, 1);
    assert.equal(call("content-delete", ctxA, { id: item.id }).ok, true);
  });
});

describe("marketing.abtest", () => {
  it("records variants and picks a winner with lift", () => {
    const t = call("abtest-create", ctxA, { name: "CTA copy", variantA: "Buy now", variantB: "Get started" }).result.test;
    call("abtest-record", ctxA, { id: t.id, variant: "a", visitors: 1000, conversions: 50 }); // 5%
    call("abtest-record", ctxA, { id: t.id, variant: "b", visitors: 1000, conversions: 70 }); // 7%
    const list = call("abtest-list", ctxA, {});
    assert.equal(list.result.tests[0].winner, "b");
    assert.equal(list.result.tests[0].liftPct, 40); // (7-5)/5
    assert.equal(call("abtest-record", ctxA, { id: t.id, variant: "c" }).ok, false);
  });
});

describe("marketing.segments + budget pacing", () => {
  it("segment-create + list total reach", () => {
    call("segment-create", ctxA, { name: "Enterprise", size: 1200 });
    call("segment-create", ctxA, { name: "SMB", size: 800 });
    assert.equal(call("segment-list", ctxA, {}).result.totalReach, 2000);
  });

  it("budget-pacing compares spend to expected", () => {
    // Window fully elapsed → expected spend equals the whole budget.
    const onTrack = newCampaign(ctxA, { budget: 3000, startDate: "2000-01-01", endDate: "2000-01-31" });
    call("metric-log", ctxA, { campaignId: onTrack.id, date: "2000-01-05", spend: 2900 });
    const bp = call("budget-pacing", ctxA, { campaignId: onTrack.id });
    assert.equal(bp.result.budget, 3000);
    assert.equal(bp.result.spent, 2900);
    assert.equal(bp.result.expectedSpend, 3000);
    assert.equal(bp.result.pace, "on_track");
    assert.equal(bp.result.utilisationPct, 97);

    // Underpacing: window elapsed, far below budget.
    const under = newCampaign(ctxA, { budget: 5000, startDate: "2000-02-01", endDate: "2000-02-28" });
    call("metric-log", ctxA, { campaignId: under.id, date: "2000-02-05", spend: 500 });
    assert.equal(call("budget-pacing", ctxA, { campaignId: under.id }).result.pace, "underpacing");
  });
});

describe("marketing.marketing-dashboard", () => {
  it("aggregates spend, revenue, blended ROAS and leads", () => {
    const c = newCampaign();
    call("metric-log", ctxA, { campaignId: c.id, date: "2026-05-01", spend: 500, revenue: 2000 });
    const lead = call("lead-add", ctxA, { name: "Lead", value: 1000 }).result.lead;
    call("lead-update-stage", ctxA, { id: lead.id, stage: "won" });
    const d = call("marketing-dashboard", ctxA, {});
    assert.equal(d.result.campaigns, 1);
    assert.equal(d.result.totalSpend, 500);
    assert.equal(d.result.blendedRoas, 4);
    assert.equal(d.result.wonDeals, 1);
  });
});
