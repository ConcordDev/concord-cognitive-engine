/**
 * Honest-delivery contract tests for the marketing domain's two former
 * fabrication sites:
 *
 *   1. marketing.email-send — used to send NO email while synthesizing
 *      per-recipient opened/clicked (strHash01) and returning fake
 *      openRate/clickRate. It must now report queued_no_provider with
 *      delivered 0 and null engagement when no SMTP provider is set.
 *   2. marketing.social-publish — used to flip status to "published"
 *      with no social API and synthesize impressions/engagements. It
 *      must now save the post as a draft and report null metrics.
 *
 * Repo-wide invariant under test: every effect a surface claims must
 * either really happen or the API honestly reports it didn't.
 *
 * Run: node --test server/tests/marketing-honest-delivery.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketingActions from "../domains/marketing.js";

// Build the macro map by calling the register function (same style as
// tests/connector-extra-paths.test.js).
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`marketing.${name}`);
  assert.ok(fn, `marketing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

let savedSmtpHost;

before(() => { registerMarketingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  savedSmtpHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST; // no email provider configured
});
afterEach(() => {
  if (savedSmtpHost === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = savedSmtpHost;
});

function newEmail() {
  return call("email-create", ctxA, {
    name: "Launch blast",
    subject: "We launched",
    blocks: [{ type: "heading", content: "Hello" }, { type: "text", content: "Body copy" }],
  }).result.email;
}

describe("marketing.email-send — honest no-provider path", () => {
  it("returns queued_no_provider with delivered 0 and null engagement (no fabricated rates)", async () => {
    const e = newEmail();
    const send = await call("email-send", ctxA, {
      id: e.id,
      recipients: ["a@x.com", "b@x.com", "c@x.com"],
    });
    assert.equal(send.ok, true);
    const r = send.result;
    assert.equal(r.status, "queued_no_provider");
    assert.equal(r.recipients, 3);
    assert.equal(r.delivered, 0);
    assert.strictEqual(r.opened, null);
    assert.strictEqual(r.clicked, null);
    assert.match(String(r.note), /No email provider configured/);
    // The fabricated analytics must be gone — not zero, GONE.
    assert.equal("openRate" in r, false, "openRate must not be synthesized");
    assert.equal("clickRate" in r, false, "clickRate must not be synthesized");
    assert.equal("sent" in r, false, "must not claim a 'sent' count when nothing was sent");
  });

  it("persists the campaign record with the honest queued status and no send rows", async () => {
    const e = newEmail();
    await call("email-send", ctxA, { id: e.id, recipients: ["a@x.com", "b@x.com"] });
    const list = call("email-list", ctxA, {});
    assert.equal(list.ok, true);
    const row = list.result.emails.find((x) => x.id === e.id);
    assert.ok(row, "email still listed");
    assert.equal(row.status, "queued_no_provider");
    assert.equal(row.lastQueueAttempt.recipients, 2);
    assert.equal(row.lastQueueAttempt.status, "queued_no_provider");
    // Nothing was delivered, so the stats must not claim sends.
    assert.equal(row.stats.sent, 0);
    assert.equal(row.stats.opened, 0);
    assert.equal(row.stats.clicked, 0);
    // lastSentAt must NOT be stamped — nothing was sent.
    assert.equal(row.lastSentAt == null, true);
  });

  it("still validates blocks and recipients before touching delivery", async () => {
    const empty = call("email-create", ctxA, { name: "Empty" }).result.email;
    assert.equal((await call("email-send", ctxA, { id: empty.id, recipients: ["x@x.com"] })).ok, false);
    const e = newEmail();
    assert.equal((await call("email-send", ctxA, { id: e.id, recipients: [] })).ok, false);
    assert.equal((await call("email-send", ctxA, { id: "nope", recipients: ["x@x.com"] })).ok, false);
  });

  it("re-sending is idempotent on the honest status (no drift into fake delivery)", async () => {
    const e = newEmail();
    const first = await call("email-send", ctxA, { id: e.id, recipients: ["a@x.com"] });
    const second = await call("email-send", ctxA, { id: e.id, recipients: ["a@x.com"] });
    assert.equal(first.result.status, "queued_no_provider");
    assert.equal(second.result.status, "queued_no_provider");
    assert.equal(second.result.delivered, 0);
  });
});

describe("marketing.social-publish — honest draft path", () => {
  function newPost() {
    return call("social-schedule", ctxA, {
      body: "New launch!",
      channels: ["twitter", "linkedin"],
    }).result.post;
  }

  it("returns draft_saved with null metrics and never fabricates reach", () => {
    const post = newPost();
    const pub = call("social-publish", ctxA, { id: post.id });
    assert.equal(pub.ok, true);
    const r = pub.result;
    assert.equal(r.status, "draft_saved");
    assert.strictEqual(r.impressions, null);
    assert.strictEqual(r.engagements, null);
    assert.match(String(r.note), /No social provider connected/);
    // The post must not claim publication or carry synthesized reach.
    assert.equal(r.post.status, "draft");
    assert.equal(r.post.publishedAt == null, true);
    assert.equal(r.post.reach == null, true, "reach must not be synthesized");
  });

  it("persists the post as a draft (not published) in social-list", () => {
    const post = newPost();
    call("social-publish", ctxA, { id: post.id });
    const list = call("social-list", ctxA, {});
    assert.equal(list.ok, true);
    const row = list.result.posts.find((p) => p.id === post.id);
    assert.ok(row, "post still listed");
    assert.equal(row.status, "draft");
    assert.equal(list.result.published, 0);
    assert.equal(row.reach == null, true);
  });

  it("publish attempt on a missing post still errors", () => {
    assert.equal(call("social-publish", ctxA, { id: "nope" }).ok, false);
  });
});

describe("surrounding macros are untouched", () => {
  it("email-list / email-delete round-trip still works", async () => {
    const e = newEmail();
    assert.equal(call("email-list", ctxA, {}).result.count, 1);
    assert.equal(call("email-delete", ctxA, { id: e.id }).ok, true);
    assert.equal(call("email-list", ctxA, {}).result.count, 0);
  });

  it("social-schedule / social-list / social-delete round-trip still works", () => {
    const post = call("social-schedule", ctxA, { body: "hi", channels: ["twitter"] }).result.post;
    const list = call("social-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.scheduled, 1);
    assert.equal(call("social-delete", ctxA, { id: post.id }).ok, true);
    assert.equal(call("social-list", ctxA, {}).result.count, 0);
  });

  it("campaign-create / campaign-list still work", () => {
    const c = call("campaign-create", ctxA, { name: "Q3 Search", channel: "search", budget: 100 }).result.campaign;
    assert.ok(c.id);
    assert.equal(call("campaign-list", ctxA, {}).result.count, 1);
  });
});
