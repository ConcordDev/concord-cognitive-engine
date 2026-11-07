// Full-build tests for the thread lens (F-B row 1) — the schedule
// lifecycle's missing half (draft-unschedule) and the rewrite pass's
// honesty signal (changed + note). Harness mirrors the shipped
// thread-domain-parity suite.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerThreadActions from "../domains/thread.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`thread.${name}`);
  assert.ok(fn, `thread.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerThreadActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function scheduledDraft(ctx) {
  const c = call("thread-draft", ctx, { content: "A thread worth scheduling for later." });
  assert.equal(c.ok, true);
  const id = c.result.draft.id;
  const s = call("draft-schedule", ctx, { id, scheduledAt: "2026-11-09T09:00:00.000Z" });
  assert.equal(s.ok, true);
  assert.equal(s.result.draft.status, "scheduled");
  return id;
}

describe("thread — draft-unschedule (the schedule lifecycle's other half)", () => {
  it("returns a scheduled draft to draft status and clears its date", () => {
    const id = scheduledDraft(ctxA);
    const u = call("draft-unschedule", ctxA, { id });
    assert.equal(u.ok, true);
    assert.equal(u.result.draft.status, "draft");
    assert.equal(u.result.draft.scheduledAt, null);
    // The queue and the dashboard counts follow.
    assert.equal(call("queue-list", ctxA, {}).result.count, 0);
    const dash = call("thread-dashboard", ctxA, {}).result;
    assert.equal(dash.scheduled, 0);
    assert.equal(dash.drafts, 1);
  });

  it("refuses in words when the draft is not scheduled", () => {
    const c = call("thread-draft", ctxA, { content: "A plain draft, never queued." });
    const u = call("draft-unschedule", ctxA, { id: c.result.draft.id });
    assert.equal(u.ok, false);
    assert.match(u.error, /not scheduled/);
  });

  it("is owner-scoped: another account's scheduled draft is not found", () => {
    const id = scheduledDraft(ctxA);
    const u = call("draft-unschedule", ctxB, { id });
    assert.equal(u.ok, false);
    assert.match(u.error, /not found/);
    // And the owner's draft is untouched.
    assert.equal(call("queue-list", ctxA, {}).result.count, 1);
  });
});

describe("thread — ai-rewrite honesty (changed signal)", () => {
  it("a tightening pass over filler text reports changed:true and shortens it", () => {
    const r = call("ai-rewrite", ctxA, {
      content: "I think that this is really just very good and basically strong in order to win.",
      mode: "tighten",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.changed, true);
    assert.equal(r.result.note, null);
    assert.notEqual(r.result.rewritten, r.result.original);
    assert.ok(r.result.rewritten.length < r.result.original.length);
  });

  it("a pass that changes nothing reports changed:false with a plain note", () => {
    const tight = "Ship the build. Verify the receipts. Tell the truth.";
    const r = call("ai-rewrite", ctxA, { content: tight, mode: "tighten" });
    assert.equal(r.ok, true);
    assert.equal(r.result.changed, false);
    assert.equal(r.result.rewritten, tight);
    assert.match(r.result.note, /No change/);
  });

  it("expand always changes the text (summary appended)", () => {
    const r = call("ai-rewrite", ctxA, {
      content: "One clear paragraph about the work and why it matters.",
      mode: "expand",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.changed, true);
  });
});
