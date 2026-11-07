// server/tests/marketing-full-build.test.js
//
// build(marketing) GB-1088 — contract tests for the two server-side slices
// of the full lens build:
//   S5 — the stored lead `source` label conforms to the attribution
//        engine: a lead created under a campaign (source absent or the
//        untouched "direct" default) stores the CAMPAIGN's name — the
//        same label attribution-report credits — instead of "direct".
//        An explicitly chosen source is never overridden, and an
//        unresolvable campaignId fabricates nothing.
//   S6 — segment-delete: the exit segment-create never had, on the
//        campaign-delete idiom (find/remove/save, named not-found),
//        per-user isolated.
// Plus an S4 pin: campaign-update (previously surfaced nowhere) writes
// exactly its documented field set.
//
// Run: node --test server/tests/marketing-full-build.test.js

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
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", db: null };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", db: null };

function newCampaign(ctx = ctxA, name = "Spring Launch") {
  const r = call("campaign-create", ctx, { name, channel: "email", budget: 500 });
  assert.equal(r.ok, true);
  return r.result.campaign;
}

describe("marketing S6 — segment-delete lifecycle", () => {
  it("create → listed → delete → gone; totalReach follows", () => {
    const seg = call("segment-create", ctxA, { name: "VIP", criteria: "spend > 100", size: 250 }).result.segment;
    let list = call("segment-list", ctxA).result;
    assert.equal(list.segments.length, 1);
    assert.equal(list.totalReach, 250);

    const del = call("segment-delete", ctxA, { id: seg.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, seg.id);

    list = call("segment-list", ctxA).result;
    assert.equal(list.segments.length, 0);
    assert.equal(list.totalReach, 0);
  });

  it("deleting an unknown id is a named failure, not a silent ok", () => {
    const r = call("segment-delete", ctxA, { id: "seg_missing" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "segment not found");
  });

  it("is per-user: another user cannot see or delete the segment", () => {
    const seg = call("segment-create", ctxA, { name: "Mine", size: 10 }).result.segment;
    assert.equal(call("segment-list", ctxB).result.segments.length, 0);
    const r = call("segment-delete", ctxB, { id: seg.id });
    assert.equal(r.ok, false);
    assert.equal(call("segment-list", ctxA).result.segments.length, 1);
  });
});

describe("marketing S5 — lead source conforms to the attribution engine", () => {
  it("lead under a campaign with no source stores the campaign's name", () => {
    const c = newCampaign(ctxA);
    const lead = call("lead-add", ctxA, { name: "Pat", campaignId: c.id }).result.lead;
    assert.equal(lead.campaignId, c.id);
    assert.equal(lead.source, "Spring Launch");
  });

  it("the FE's untouched default 'direct' conforms the same way", () => {
    const c = newCampaign(ctxA);
    const lead = call("lead-add", ctxA, { name: "Sam", campaignId: c.id, source: "direct" }).result.lead;
    assert.equal(lead.source, "Spring Launch");
  });

  it("an explicitly chosen source is never overridden", () => {
    const c = newCampaign(ctxA);
    const lead = call("lead-add", ctxA, { name: "Jo", campaignId: c.id, source: "Partner Referral" }).result.lead;
    assert.equal(lead.source, "partner referral");
  });

  it("no campaign → 'direct'; unresolvable campaignId fabricates nothing", () => {
    const plain = call("lead-add", ctxA, { name: "NoCamp" }).result.lead;
    assert.equal(plain.source, "direct");
    assert.equal(plain.campaignId, null);
    const ghost = call("lead-add", ctxA, { name: "Ghost", campaignId: "camp_missing" }).result.lead;
    assert.equal(ghost.source, "direct");
  });

  it("label and engine agree end-to-end on a won deal", () => {
    const c = newCampaign(ctxA);
    const lead = call("lead-add", ctxA, { name: "Won", campaignId: c.id, value: 750 }).result.lead;
    call("lead-update-stage", ctxA, { id: lead.id, stage: "won" });
    const report = call("attribution-report", ctxA).result;
    assert.equal(report.attribution.length, 1);
    assert.equal(report.attribution[0].campaign, "Spring Launch");
    assert.equal(report.attribution[0].revenue, 750);
    // The stored label IS the label the engine credits.
    assert.equal(lead.source, report.attribution[0].campaign);
  });
});

describe("marketing S4 pin — campaign-update field set", () => {
  it("updates name/budget/endDate/status and returns the campaign", () => {
    const c = newCampaign(ctxA);
    const r = call("campaign-update", ctxA, {
      id: c.id, name: "Spring Launch II", budget: 900, endDate: "2026-12-31", status: "paused",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.campaign.name, "Spring Launch II");
    assert.equal(r.result.campaign.budget, 900);
    assert.equal(r.result.campaign.endDate, "2026-12-31");
    assert.equal(r.result.campaign.status, "paused");
    // Channel is not in the verb's field set and is untouched.
    assert.equal(r.result.campaign.channel, "email");
  });
});
