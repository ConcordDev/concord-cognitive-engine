// server/tests/marketing-campaign-gmail-send.test.js
//
// Wave-4 gap-closure (marketing row): campaign "send" used to be
// compute-only (ROI/KPI math on typed-in numbers) — there was no way to
// actually deliver a campaign to anyone. `marketing.campaign-send-gmail`
// closes that honestly for LOW-VOLUME sends by reusing the real,
// SSRF-guarded, per-user-OAuth Gmail sender (lib/connector-client.js
// #writeGmailMessage) already shipped for Track C — same function
// domains/gmail.js#send calls, unmodified.
//
// Gmail egress is intercepted via the same test-only `fetchImpl` seam
// connectorFetch already exposes (see connector-read-paths.test.js /
// travel-inbox-sync.test.js) — no live Google call, no live server boot.
// The macro also exposes a `__fetchImpl` param seam (same idiom as
// domains/travel.js#inbox-sync) so this test can inject it end-to-end
// through the registered macro itself, not just the underlying helper.
//
// Contract under test:
//   1. A recipient is reported "sent" ONLY when the stubbed Gmail 2xx
//      actually fires — never fabricated.
//   2. No Gmail OAuth connection -> honest `gmail_not_connected`, zero
//      sends attempted, zero side effects.
//   3. A per-recipient Gmail failure is recorded as "failed" with a real
//      reason, and never counted toward `sent`.
//   4. The low per-run recipient cap is enforced and surfaced honestly
//      (`capped`, `cap`, `requested` vs `attempted`).
//
// Run: node --test server/tests/marketing-campaign-gmail-send.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import registerMarketingActions from "../domains/marketing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`marketing.${name}`);
  assert.ok(fn, `marketing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketingActions(register); });

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, userId = "user_a") {
  persistConnectorToken(db, userId, "google_gmail", { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "gmail.send" });
}

const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// Decode the base64url `raw` RFC-822 body writeGmailMessage builds, so a
// fetchImpl stub can branch per-recipient off the real "To:" header (not
// just a fixed response) — mirrors how connector-read-paths.test.js /
// travel-inbox-sync.test.js route their stubs off real request shape.
function decodeRawTo(init) {
  const body = JSON.parse(init.body);
  const rfc822 = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const m = /^To: (.+)$/m.exec(rfc822);
  return m ? m[1].trim() : null;
}

const ctxA = (db) => ({ actor: { userId: "user_a" }, userId: "user_a", db });

function newCampaign(db) {
  return call("campaign-create", ctxA(db), { name: "Launch Blast", channel: "email", budget: 500 }).result.campaign;
}

describe("marketing.campaign-send-gmail — honest not-connected failure", () => {
  let db;
  beforeEach(() => {
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
    db = freshDb();
  });
  afterEach(() => { db.close(); });

  it("returns gmail_not_connected with no token seeded — never a fabricated sent count", async () => {
    const campaign = newCampaign(db);
    const r = await call("campaign-send-gmail", ctxA(db), {
      campaignId: campaign.id, recipients: ["a@x.com", "b@x.com"], subject: "Hi", body: "Hello there",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "gmail_not_connected");
    assert.equal(r.error, "gmail_not_connected");
    // Zero side effects: no send history was recorded.
    const history = call("campaign-gmail-send-history", ctxA(db), { campaignId: campaign.id });
    assert.equal(history.result.count, 0);
  });

  it("rejects an unknown campaign before touching Gmail (even with a token seeded)", async () => {
    seedToken(db);
    const r = await call("campaign-send-gmail", ctxA(db), { campaignId: "nope", recipients: ["a@x.com"], body: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "campaign not found");
  });

  it("rejects an anonymous caller", async () => {
    seedToken(db);
    const campaign = newCampaign(db);
    const r = await call("campaign-send-gmail", { actor: { userId: "anon" }, db }, { campaignId: campaign.id, recipients: ["a@x.com"], body: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("requires at least one recipient", async () => {
    seedToken(db);
    const campaign = newCampaign(db);
    const r = await call("campaign-send-gmail", ctxA(db), { campaignId: campaign.id, recipients: [], body: "hi" });
    assert.equal(r.ok, false);
    assert.match(r.error, /recipient/);
  });

  it("requires a non-empty body", async () => {
    seedToken(db);
    const campaign = newCampaign(db);
    const r = await call("campaign-send-gmail", ctxA(db), { campaignId: campaign.id, recipients: ["a@x.com"], body: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /body/);
  });
});

describe("marketing.campaign-send-gmail — real per-recipient send (mocked Gmail egress)", () => {
  let db;
  beforeEach(() => {
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
    db = freshDb();
    seedToken(db);
  });
  afterEach(() => { db.close(); });

  it("sends per-recipient and records a real sent result only on a real 2xx", async () => {
    const campaign = newCampaign(db);
    let calls = 0;
    const __fetchImpl = async (url, init) => {
      calls++;
      assert.match(url, /\/messages\/send$/);
      const to = decodeRawTo(init);
      return resp({ id: `msg_${to}`, threadId: `thr_${to}` }, 200);
    };
    const r = await call("campaign-send-gmail", ctxA(db), {
      campaignId: campaign.id, recipients: ["a@x.com", "b@x.com", "c@x.com"], subject: "Q3 Launch", body: "Hello!", __fetchImpl,
    });
    assert.equal(r.ok, true);
    assert.equal(calls, 3, "one real Gmail API call per recipient");
    assert.equal(r.result.requested, 3);
    assert.equal(r.result.attempted, 3);
    assert.equal(r.result.sent, 3);
    assert.equal(r.result.failed, 0);
    assert.equal(r.result.capped, false);
    assert.equal(r.result.results.length, 3);
    for (const row of r.result.results) {
      assert.equal(row.status, "sent");
      assert.equal(row.providerMessageId, `msg_${row.to}`);
    }
    assert.match(r.result.note, /low-volume, per-user send/);
    assert.match(r.result.note, /ESP/);

    // Persisted into real send history for the campaign.
    const history = call("campaign-gmail-send-history", ctxA(db), { campaignId: campaign.id });
    assert.equal(history.result.count, 1);
    assert.equal(history.result.sends[0].sent, 3);
  });

  it("never fabricates a sent status when Gmail rejects a specific recipient", async () => {
    const campaign = newCampaign(db);
    const __fetchImpl = async (_url, init) => {
      const to = decodeRawTo(init);
      if (to === "bad@x.com") return resp({ error: { message: "Invalid To header" } }, 400);
      return resp({ id: `msg_${to}` }, 200);
    };
    const r = await call("campaign-send-gmail", ctxA(db), {
      campaignId: campaign.id, recipients: ["good1@x.com", "bad@x.com", "good2@x.com"], body: "hi", __fetchImpl,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sent, 2);
    assert.equal(r.result.failed, 1);
    const bad = r.result.results.find((x) => x.to === "bad@x.com");
    assert.equal(bad.status, "failed");
    assert.equal("providerMessageId" in bad, false);
    assert.equal(bad.reason, "provider_error");
    const good = r.result.results.filter((x) => x.status === "sent");
    assert.equal(good.length, 2);
    // The overall call must never claim more sent than actually got a 2xx.
    assert.equal(r.result.results.filter((x) => x.status === "sent").length, r.result.sent);
  });

  it("a total transport failure (network throw) is recorded as a real per-recipient failure, not a sent", async () => {
    const campaign = newCampaign(db);
    const __fetchImpl = async () => { throw new Error("ECONNRESET"); };
    const r = await call("campaign-send-gmail", ctxA(db), {
      campaignId: campaign.id, recipients: ["a@x.com"], body: "hi", __fetchImpl,
    });
    assert.equal(r.ok, true); // the campaign-send call itself completes...
    assert.equal(r.result.sent, 0); // ...but nothing was actually sent
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.results[0].status, "failed");
  });

  it("enforces the low per-run recipient cap and surfaces it honestly", async () => {
    const campaign = newCampaign(db);
    const recipients = Array.from({ length: 30 }, (_, i) => `user${i}@x.com`);
    const __fetchImpl = async (_url, init) => resp({ id: `msg_${decodeRawTo(init)}` }, 200);
    const r = await call("campaign-send-gmail", ctxA(db), { campaignId: campaign.id, recipients, body: "hi", __fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.result.requested, 30);
    assert.equal(r.result.capped, true);
    assert.equal(r.result.cap, 20);
    assert.equal(r.result.attempted, 20);
    assert.equal(r.result.sent, 20);
    assert.equal(r.result.results.length, 20);
    assert.match(r.result.note, /Capped at 20 of 30/);
  });

  it("dedupes duplicate recipients before counting against the cap", async () => {
    const campaign = newCampaign(db);
    const __fetchImpl = async (_url, init) => resp({ id: `msg_${decodeRawTo(init)}` }, 200);
    const r = await call("campaign-send-gmail", ctxA(db), {
      campaignId: campaign.id, recipients: ["a@x.com", "a@x.com", "b@x.com"], body: "hi", __fetchImpl,
    });
    assert.equal(r.result.requested, 2);
    assert.equal(r.result.sent, 2);
  });

  it("history returns multiple runs, most recent first", async () => {
    const campaign = newCampaign(db);
    const __fetchImpl = async (_url, init) => resp({ id: `msg_${decodeRawTo(init)}` }, 200);
    await call("campaign-send-gmail", ctxA(db), { campaignId: campaign.id, recipients: ["a@x.com"], body: "first", __fetchImpl });
    await call("campaign-send-gmail", ctxA(db), { campaignId: campaign.id, recipients: ["b@x.com", "c@x.com"], body: "second", __fetchImpl });
    const history = call("campaign-gmail-send-history", ctxA(db), { campaignId: campaign.id });
    assert.equal(history.result.count, 2);
    assert.equal(history.result.sends[0].sent, 2); // most recent (second run) first
    assert.equal(history.result.sends[1].sent, 1);
  });
});

describe("surrounding campaign macros are untouched", () => {
  it("campaign-create / campaign-list / campaign-detail still work", () => {
    const db = freshDb();
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
    const campaign = newCampaign(db);
    assert.ok(campaign.id);
    assert.equal(call("campaign-list", ctxA(db), {}).result.count, 1);
    const detail = call("campaign-detail", ctxA(db), { id: campaign.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.campaign.id, campaign.id);
    db.close();
  });
});
