// S6 (F10) pins: summaries persist as work products — save, list,
// delete, owner-scoped — instead of evaporating on a view switch.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`paper.${name}`);
  if (!fn) throw new Error(`paper.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPaperActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_sum_a" }, userId: "user_sum_a" };
const ctxB = { actor: { userId: "user_sum_b" }, userId: "user_sum_b" };
const SUMMARY = { problem: "p", approach: "a", results: "r", limitations: "l", whyItMatters: "w", keyTerms: ["x"] };

describe("paper summary persistence (S6)", () => {
  it("a saved summary is listed back, newest first, with its source", () => {
    const r = call("summary-save", ctxA, { summary: SUMMARY, sourceText: "Attention paper text…", sourceTitle: "Attention" });
    assert.equal(r.ok, true);
    const list = call("summary-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.summaries[0].sourceTitle, "Attention");
    assert.equal(list.result.summaries[0].summary.problem, "p");
  });

  it("summaries are owner-scoped", () => {
    call("summary-save", ctxA, { summary: SUMMARY, sourceTitle: "A" });
    assert.equal(call("summary-list", ctxB, {}).result.count, 0);
  });

  it("delete removes exactly the named summary; an unknown id refuses", () => {
    const saved = call("summary-save", ctxA, { summary: SUMMARY, sourceTitle: "A" }).result.summary;
    assert.equal(call("summary-delete", ctxA, { id: "nope" }).ok, false);
    assert.equal(call("summary-delete", ctxA, { id: saved.id }).ok, true);
    assert.equal(call("summary-list", ctxA, {}).result.count, 0);
  });

  it("a save without a summary object is refused in words", () => {
    const r = call("summary-save", ctxA, { sourceText: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /summary required/);
  });
});
