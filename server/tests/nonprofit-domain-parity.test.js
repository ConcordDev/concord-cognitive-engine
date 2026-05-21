// Contract tests for server/domains/nonprofit.js — pure-compute
// donor/grant/volunteer/campaign macros plus real ProPublica Nonprofit
// Explorer (IRS 990) integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNonprofitActions from "../domains/nonprofit.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`nonprofit.${name}`);
  if (!fn) throw new Error(`nonprofit.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerNonprofitActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("nonprofit.donorRetention", () => {
  it("computes retention rate between consecutive years", () => {
    const history = [
      { donorId: "alice", date: "2025-03-01" },
      { donorId: "bob", date: "2025-04-15" },
      { donorId: "alice", date: "2026-02-10" },
      { donorId: "carol", date: "2026-05-01" },
    ];
    const r = call("donorRetention", ctxA, { data: { givingHistory: history } }, { year: 2026 });
    assert.equal(r.ok, true);
    // alice retained, bob lapsed → 1/2 = 50%
    assert.equal(r.result.retentionRate, 50);
    assert.equal(r.result.retained, 1);
    assert.equal(r.result.priorTotal, 2);
  });
});

describe("nonprofit.campaignProgress", () => {
  it("computes percent + projected total", () => {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const r = call("campaignProgress", ctxA, {
      title: "Build the Library",
      data: { goalAmount: 100_000, raisedAmount: 30_000, donorCount: 120, startDate: start, endDate: end },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.percentComplete, 30);
    assert.ok(r.result.projected >= 50_000 && r.result.projected <= 70_000);
  });
});

describe("nonprofit.lookup-org-by-ein (ProPublica Nonprofit Explorer)", () => {
  it("rejects missing EIN", async () => {
    const r = await call("lookup-org-by-ein", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /ein required/);
  });

  it("rejects bad EIN length", async () => {
    const r = await call("lookup-org-by-ein", ctxA, { ein: "123" });
    assert.equal(r.ok, false);
    assert.match(r.error, /9 digits/);
  });

  it("strips non-digits (handles 13-1234567 hyphenated EINs)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ organization: { ein: "131234567", name: "X", subsection_code: 3 }, filings_with_data: [] }) };
    };
    await call("lookup-org-by-ein", ctxA, { ein: "13-1234567" });
    assert.match(capturedUrl, /organizations\/131234567\.json/);
  });

  it("hits ProPublica and shapes the real response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        organization: {
          ein: "530196605",
          name: "AMERICAN RED CROSS",
          address: "431 18TH ST NW", city: "WASHINGTON", state: "DC", zipcode: "20006-5310",
          ntee_code: "M20",
          ntee_classification: "Disaster Preparedness and Relief Service",
          ruling_date: "1938-12-01T00:00:00.000-05:00",
          subsection_code: 3,
          deductibility: 1,
          asset_amount: 4123456789,
          income_amount: 3000000000,
          revenue_amount: 3100000000,
        },
        filings_with_data: [
          { tax_prd: 202206, tax_prd_yr: 2022, totrevenue: 3000000000, totfuncexpns: 2900000000, totassetsend: 4123456789, pdf_url: "https://example.org/990.pdf" },
        ],
      }),
    });
    const r = await call("lookup-org-by-ein", ctxA, { ein: "530196605" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "AMERICAN RED CROSS");
    assert.equal(r.result.address.city, "WASHINGTON");
    assert.equal(r.result.taxExemptStatus, "501(c)(3)");
    assert.equal(r.result.deductible, true);
    assert.equal(r.result.rulingYear, 1938);
    assert.equal(r.result.filings.length, 1);
    assert.equal(r.result.filings[0].netIncome, 100000000);
    assert.equal(r.result.source, "propublica-nonprofit-explorer");
  });

  it("returns clear 404 when EIN doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("lookup-org-by-ein", ctxA, { ein: "999999999" });
    assert.equal(r.ok, false);
    assert.match(r.error, /EIN not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Backlog-feature macros (donor CRM, segmentation, comms, receipts,
// recurring giving, donation pages, volunteers, events / P2P).
// These need a STATE-backed harness — install one before each block.
// ─────────────────────────────────────────────────────────────────────
function withState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
}

describe("nonprofit donor CRM", () => {
  beforeEach(withState);
  it("creates, lists, updates, deletes donors scoped per user", () => {
    const d = call("donor-create", ctxA, { name: "Ada Lovelace", email: "ada@x.org" }).result.donor;
    assert.ok(d.id);
    assert.equal(call("donor-list", ctxA, {}).result.count, 1);
    assert.equal(call("donor-list", { actor: { userId: "u_b" }, userId: "u_b" }, {}).result.count, 0);
    const upd = call("donor-update", ctxA, { id: d.id, phone: "555-1234" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.donor.phone, "555-1234");
    assert.equal(call("donor-delete", ctxA, { id: d.id }).ok, true);
    assert.equal(call("donor-list", ctxA, {}).result.count, 0);
  });
  it("rejects a nameless donor", () => {
    assert.equal(call("donor-create", ctxA, {}).ok, false);
  });
  it("logs gifts to a donor and computes stats", () => {
    const d = call("donor-create", ctxA, { name: "Grace" }).result.donor;
    call("donor-gift-log", ctxA, { donorId: d.id, amount: 200, fund: "General" });
    const r = call("donor-gift-log", ctxA, { donorId: d.id, amount: 300 });
    assert.equal(r.ok, true);
    assert.equal(r.result.donor.totalGiven, 500);
    assert.equal(r.result.donor.giftCount, 2);
    assert.equal(call("donor-gift-log", ctxA, { donorId: d.id, amount: 0 }).ok, false);
    assert.equal(call("donor-gift-log", ctxA, { donorId: "nope", amount: 5 }).ok, false);
  });
});

describe("nonprofit donor segmentation", () => {
  beforeEach(withState);
  it("buckets donors into major / first-time / prospect", () => {
    const big = call("donor-create", ctxA, { name: "Big" }).result.donor;
    call("donor-gift-log", ctxA, { donorId: big.id, amount: 5000 });
    const once = call("donor-create", ctxA, { name: "Once" }).result.donor;
    call("donor-gift-log", ctxA, { donorId: once.id, amount: 50 });
    call("donor-create", ctxA, { name: "Cold Lead" });
    const r = call("donor-segment", ctxA, { majorThreshold: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.major, 1);
    assert.equal(r.result.summary.firstTime, 2);
    assert.equal(r.result.summary.prospect, 1);
  });
});

describe("nonprofit communications", () => {
  beforeEach(withState);
  it("composes a thank-you preview without sending", () => {
    const d = call("donor-create", ctxA, { name: "Pat" }).result.donor;
    const r = call("comm-compose", ctxA, { donorId: d.id, kind: "thank_you" });
    assert.equal(r.ok, true);
    assert.match(r.result.subject, /Thank you/);
  });
  it("sends a comm and appends it to the donor log", () => {
    const d = call("donor-create", ctxA, { name: "Pat" }).result.donor;
    assert.equal(call("comm-send", ctxA, { donorId: d.id, kind: "appeal", cause: "clean water" }).ok, true);
    assert.equal(call("comm-log", ctxA, { donorId: d.id }).result.count, 1);
  });
  it("thank-you automation acknowledges every pending gift", () => {
    const d = call("donor-create", ctxA, { name: "Pat" }).result.donor;
    call("donor-gift-log", ctxA, { donorId: d.id, amount: 100 });
    const r = call("thankyou-run", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.sent, 1);
    assert.equal(call("thankyou-run", ctxA, {}).result.sent, 0);
  });
});

describe("nonprofit tax receipts", () => {
  beforeEach(withState);
  it("generates a per-gift receipt and an annual statement", () => {
    const d = call("donor-create", ctxA, { name: "Pat", address: "1 Main St" }).result.donor;
    const g = call("donor-gift-log", ctxA, { donorId: d.id, amount: 250 }).result.gift;
    const r = call("receipt-generate", ctxA, { donorId: d.id, giftId: g.id });
    assert.equal(r.ok, true);
    assert.match(r.result.receipt.receiptNo, /^R-/);
    assert.equal(r.result.receipt.amount, 250);
    const ann = call("receipt-annual", ctxA, { donorId: d.id, year: new Date().getFullYear() });
    assert.equal(ann.ok, true);
    assert.equal(ann.result.statement.totalDeductible, 250);
  });
});

describe("nonprofit recurring giving", () => {
  beforeEach(withState);
  it("creates, lists, charges, and cancels a pledge", () => {
    const d = call("donor-create", ctxA, { name: "Pat" }).result.donor;
    const p = call("pledge-create", ctxA, { donorId: d.id, amount: 25, frequency: "monthly" }).result.pledge;
    assert.equal(call("pledge-list", ctxA, {}).result.active, 1);
    const charged = call("pledge-charge", ctxA, { donorId: d.id, pledgeId: p.id });
    assert.equal(charged.ok, true);
    assert.equal(charged.result.pledge.paid, 25);
    assert.equal(call("pledge-update", ctxA, { donorId: d.id, pledgeId: p.id, status: "paused" }).result.pledge.status, "paused");
    assert.equal(call("pledge-cancel", ctxA, { donorId: d.id, pledgeId: p.id }).result.pledge.status, "cancelled");
  });
  it("rejects a non-positive pledge", () => {
    const d = call("donor-create", ctxA, { name: "Pat" }).result.donor;
    assert.equal(call("pledge-create", ctxA, { donorId: d.id, amount: 0 }).ok, false);
  });
});

describe("nonprofit donation pages", () => {
  beforeEach(withState);
  it("creates a page, publishes it, and accepts a gift", () => {
    const p = call("donation-page-create", ctxA, { title: "Save the Reef", goal: 1000 }).result.page;
    assert.ok(p.slug);
    assert.equal(call("donation-page-give", ctxA, { pageId: p.id, amount: 50 }).ok, false); // unpublished
    call("donation-page-update", ctxA, { id: p.id, published: true });
    const g = call("donation-page-give", ctxA, { pageId: p.id, amount: 200, donor: "Sam" });
    assert.equal(g.ok, true);
    assert.equal(g.result.raised, 200);
    assert.equal(call("donation-page-list", ctxA, {}).result.pages[0].progressPct, 20);
    assert.equal(call("donation-page-delete", ctxA, { id: p.id }).ok, true);
  });
});

describe("nonprofit volunteer management", () => {
  beforeEach(withState);
  it("signs up a volunteer, schedules a shift, logs hours", () => {
    const v = call("volunteer-signup", ctxA, { name: "Lee", skills: "driving,cooking" }).result.volunteer;
    assert.equal(v.skills.length, 2);
    const sh = call("shift-schedule", ctxA, { volunteerId: v.id, role: "Kitchen", hours: 4 }).result.shift;
    const logged = call("shift-log-hours", ctxA, { volunteerId: v.id, shiftId: sh.id, hours: 3.5 });
    assert.equal(logged.ok, true);
    assert.equal(logged.result.totalHours, 3.5);
    assert.equal(call("volunteer-list", ctxA, {}).result.totalHours, 3.5);
    assert.equal(call("volunteer-delete", ctxA, { id: v.id }).ok, true);
  });
});

describe("nonprofit events + peer-to-peer", () => {
  beforeEach(withState);
  it("creates an event, p2p team, donation, and leaderboard", () => {
    const ev = call("event-create", ctxA, { name: "Charity Walk", goal: 5000 }).result.event;
    const team = call("p2p-team-create", ctxA, { eventId: ev.id, captain: "Jordan" }).result.team;
    const don = call("p2p-donate", ctxA, { eventId: ev.id, teamId: team.id, amount: 150, donor: "Fan" });
    assert.equal(don.ok, true);
    assert.equal(don.result.teamRaised, 150);
    const board = call("p2p-leaderboard", ctxA, { eventId: ev.id });
    assert.equal(board.ok, true);
    assert.equal(board.result.leaderboard[0].rank, 1);
    assert.equal(board.result.totalRaised, 150);
    assert.equal(call("event-list", ctxA, {}).result.events[0].raised, 150);
    assert.equal(call("event-delete", ctxA, { id: ev.id }).ok, true);
  });
});

describe("nonprofit.search-orgs (ProPublica search)", () => {
  it("rejects short queries", async () => {
    assert.equal((await call("search-orgs", ctxA, { query: "a" })).ok, false);
  });

  it("hits ProPublica search and shapes the result list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          total_results: 2, num_pages: 1, cur_page: 0,
          organizations: [
            { ein: "530196605", name: "AMERICAN RED CROSS", city: "WASHINGTON", state: "DC", ntee_code: "M20", score: 18.0, ruling_date: "1938-12-01T00:00:00" },
            { ein: "131635294", name: "DOCTORS WITHOUT BORDERS USA INC", city: "NEW YORK", state: "NY", ntee_code: "Q33", score: 14.5, ruling_date: "1990-04-01T00:00:00" },
          ],
        }),
      };
    };
    const r = await call("search-orgs", ctxA, { query: "red cross", state: "DC" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /search\.json\?q=red%20cross/);
    assert.match(capturedUrl, /state%5Bid%5D=DC/);
    assert.equal(r.result.totalResults, 2);
    assert.equal(r.result.orgs[0].ein, "530196605");
    assert.equal(r.result.orgs[1].rulingYear, 1990);
    assert.equal(r.result.source, "propublica-nonprofit-explorer");
  });

  it("surfaces propublica network failures", async () => {
    const r = await call("search-orgs", ctxA, { query: "abc" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});
