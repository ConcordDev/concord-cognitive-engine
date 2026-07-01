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

/* ════════════════════════════════════════════════════════════════════
 *  HubSpot-parity backlog macros — email builder + send, automation
 *  workflows, landing pages + forms, social scheduler, lead-scoring
 *  model editor, SEO audit, CRM contact sync, campaign calendar.
 * ════════════════════════════════════════════════════════════════════ */

describe("marketing.email builder + send engine", () => {
  it("creates, lists, and sends HONESTLY without a provider (no fabricated analytics)", async () => {
    const e = call("email-create", ctxA, {
      name: "Welcome", subject: "Hi there",
      blocks: [{ type: "heading", content: "Welcome!" }, { type: "text", content: "Body" }],
    }).result.email;
    assert.ok(e.id);
    assert.equal(e.blocks.length, 2);
    const list = call("email-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.emails[0].blockCount, 2);
    // HONEST contract (no SMTP in tests): recorded, nothing sent, no invented engagement.
    const send = await call("email-send", ctxA, { id: e.id, recipients: ["a@x.com", "b@x.com", "c@x.com"] });
    assert.equal(send.ok, true);
    assert.equal(send.result.status, "queued_no_provider");
    assert.equal(send.result.recipients, 3);
    assert.equal(send.result.delivered, 0);
    assert.equal(send.result.opened, null);   // never synthesized
    assert.equal(send.result.clicked, null);  // never synthesized
    // list stats honestly show 0 sent for a queued-no-provider campaign.
    assert.equal(call("email-list", ctxA, {}).result.emails[0].stats.sent, 0);
    assert.equal(call("email-delete", ctxA, { id: e.id }).ok, true);
  });

  it("rejects sends with no blocks or no recipients", async () => {
    const empty = call("email-create", ctxA, { name: "Empty" }).result.email;
    assert.equal((await call("email-send", ctxA, { id: empty.id, recipients: ["x@x.com"] })).ok, false);
    const ok = call("email-create", ctxA, { name: "OK", blocks: [{ type: "text", content: "hi" }] }).result.email;
    assert.equal((await call("email-send", ctxA, { id: ok.id, recipients: [] })).ok, false);
  });

  it("create requires a name", () => {
    assert.equal(call("email-create", ctxA, {}).ok, false);
  });
});

describe("marketing.automation workflows", () => {
  it("creates, activates, enrolls and traces a run", () => {
    const w = call("workflow-create", ctxA, {
      name: "Nurture", steps: [
        { type: "trigger", label: "Form submit" },
        { type: "delay", label: "Wait", delayHours: 24 },
        { type: "send_email", label: "Day 1 email" },
        { type: "goal", label: "Booked demo" },
      ],
    }).result.workflow;
    assert.equal(w.stepCount, undefined);
    assert.equal(w.steps.length, 4);
    // enrolling before activation is rejected
    assert.equal(call("workflow-enroll", ctxA, { id: w.id, contact: "c@x.com" }).ok, false);
    call("workflow-update", ctxA, { id: w.id, status: "active" });
    const run = call("workflow-enroll", ctxA, { id: w.id, contact: "c@x.com" });
    assert.equal(run.ok, true);
    assert.ok(run.result.run.durationHours >= 24);
    assert.ok(run.result.run.trace.length >= 1);
    const runs = call("workflow-runs", ctxA, { id: w.id });
    assert.equal(runs.result.count, 1);
    const list = call("workflow-list", ctxA, {});
    assert.equal(list.result.workflows[0].enrolled, 1);
    assert.equal(call("workflow-delete", ctxA, { id: w.id }).ok, true);
  });

  it("create requires a name", () => {
    assert.equal(call("workflow-create", ctxA, {}).ok, false);
  });
});

describe("marketing.landing pages + forms", () => {
  it("builds a page, publishes, captures a submission that becomes a lead", () => {
    const p = call("page-create", ctxA, {
      name: "Demo signup", headline: "Get a demo",
      fields: [
        { type: "email", label: "Email", required: true },
        { type: "text", label: "Name", required: false },
      ],
    }).result.page;
    assert.ok(p.slug);
    // submitting before publish is rejected
    assert.equal(call("page-submit", ctxA, { id: p.id, values: { Email: "x@x.com" } }).ok, false);
    call("page-update", ctxA, { id: p.id, status: "published" });
    // required field enforced
    assert.equal(call("page-submit", ctxA, { id: p.id, values: { Name: "Bob" } }).ok, false);
    const sub = call("page-submit", ctxA, { id: p.id, values: { Email: "bob@x.com", Name: "Bob" } });
    assert.equal(sub.ok, true);
    assert.ok(sub.result.leadId);
    const subs = call("page-submissions", ctxA, { id: p.id });
    assert.equal(subs.result.count, 1);
    assert.equal(call("page-list", ctxA, {}).result.pages[0].submissions, 1);
    assert.equal(call("page-delete", ctxA, { id: p.id }).ok, true);
  });

  it("create requires a name", () => {
    assert.equal(call("page-create", ctxA, {}).ok, false);
  });
});

describe("marketing.social scheduler", () => {
  it("schedules, lists, and publish HONESTLY saves a draft (no provider → no fabricated reach)", () => {
    const post = call("social-schedule", ctxA, {
      body: "New launch!", channels: ["twitter", "linkedin"],
    }).result.post;
    assert.equal(post.channels.length, 2);
    assert.equal(post.status, "scheduled");
    const list = call("social-list", ctxA, {});
    assert.equal(list.result.scheduled, 1);
    // HONEST contract: no social provider is connected, so nothing is
    // "published" and reach is never invented.
    const pub = call("social-publish", ctxA, { id: post.id });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.status, "draft_saved");
    assert.equal(pub.result.impressions, null);
    assert.equal(pub.result.engagements, null);
    assert.equal(pub.result.post.status, "draft");
    assert.equal("reach" in pub.result.post, false); // no fabricated reach object
    assert.equal(call("social-delete", ctxA, { id: post.id }).ok, true);
  });

  it("rejects an empty body or invalid channels", () => {
    assert.equal(call("social-schedule", ctxA, { body: "", channels: ["twitter"] }).ok, false);
    assert.equal(call("social-schedule", ctxA, { body: "hi", channels: ["myspace"] }).ok, false);
  });
});

describe("marketing.lead scoring model editor", () => {
  it("saves a rule-based model and applies it to a lead", () => {
    const model = call("scoring-model-save", ctxA, {
      name: "Fit score", threshold: 30,
      rules: [{ signal: "pricing_visit", points: 20 }, { signal: "demo_request", points: 40 }],
    }).result.model;
    assert.equal(model.rules.length, 2);
    assert.equal(call("scoring-model-list", ctxA, {}).result.models[0].maxScore, 60);
    const lead = call("lead-add", ctxA, { name: "Acme" }).result.lead;
    const applied = call("scoring-model-apply", ctxA, {
      modelId: model.id, leadId: lead.id,
      signals: { pricing_visit: 2, demo_request: 1 },
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.score, 2 * 20 + 1 * 40); // 80
    assert.equal(applied.result.qualified, true);
    assert.equal(applied.result.breakdown.length, 2);
    assert.equal(call("scoring-model-delete", ctxA, { id: model.id }).ok, true);
  });

  it("rejects a model with no rules", () => {
    assert.equal(call("scoring-model-save", ctxA, { name: "Empty", rules: [] }).ok, false);
  });
});

describe("marketing.SEO audit", () => {
  it("scores on-page checks from real text inputs", () => {
    const longBody = Array.from({ length: 320 }, () => "concord").join(" ");
    const audit = call("seo-audit", ctxA, {
      url: "https://x.com/page", keyword: "concord",
      title: "A great page about concord marketing tools for you",
      metaDescription: "This is a meta description that is hopefully long enough to pass the seventy character minimum check here.",
      bodyText: longBody, headingCount: 3, imageCount: 2, imagesWithAlt: 2,
    }).result.audit;
    assert.ok(audit.id);
    assert.equal(audit.wordCount, 320);
    assert.ok(audit.checks.length >= 5);
    assert.ok(audit.score >= 0 && audit.score <= 100);
    const list = call("seo-audit-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(call("seo-audit-delete", ctxA, { id: audit.id }).ok, true);
  });

  it("requires a url", () => {
    assert.equal(call("seo-audit", ctxA, {}).ok, false);
  });
});

describe("marketing.CRM contact sync", () => {
  it("upserts, lists, searches and bidirectionally syncs with leads", () => {
    const c = call("contact-upsert", ctxA, {
      email: "Dana@X.com", name: "Dana", company: "Acme",
    }).result.contact;
    assert.equal(c.email, "dana@x.com"); // normalised
    // upsert again merges
    call("contact-upsert", ctxA, { email: "dana@x.com", phone: "555-1" });
    assert.equal(call("contact-list", ctxA, {}).result.count, 1);
    assert.equal(call("contact-list", ctxA, { query: "acme" }).result.count, 1);
    // a lead with email syncs into contacts and vice versa
    call("lead-add", ctxA, { name: "Erin", email: "erin@x.com" });
    const sync = call("contact-sync", ctxA, {});
    assert.equal(sync.ok, true);
    assert.equal(sync.result.importedFromLeads, 1); // erin
    assert.ok(sync.result.exportedToLeads >= 1);    // dana
    assert.equal(call("contact-delete", ctxA, { id: c.id }).ok, true);
  });

  it("requires an email", () => {
    assert.equal(call("contact-upsert", ctxA, {}).ok, false);
  });
});

describe("marketing.campaign calendar", () => {
  it("collapses campaigns, content and social posts onto a timeline", () => {
    call("campaign-create", ctxA, { name: "Spring push", startDate: "2026-06-01" });
    call("content-add", ctxA, { title: "Launch post", scheduledDate: "2026-06-02" });
    call("social-schedule", ctxA, { body: "Teaser", channels: ["twitter"], scheduledAt: "2026-06-03T10:00:00Z" });
    const cal = call("campaign-calendar", ctxA, {});
    assert.equal(cal.ok, true);
    assert.ok(cal.result.count >= 3);
    assert.ok(cal.result.days.length >= 3);
    // range filtering
    const ranged = call("campaign-calendar", ctxA, { from: "2026-06-02", to: "2026-06-02" });
    assert.equal(ranged.result.count, 1);
  });
});
