// FIX-ethics-012 — the Decision Matrix crowned a junk winner on an
// empty run: submit one stray-named option with no scores (the panel
// sends 0 for untouched cells) and the macro returned "Winner: d" at
// 0% and PERSISTED the record; the same shape arose with every
// criterion weight at 0 (all totals 0, first option wins by sort
// order). Validation now refuses both degenerate runs before a
// winner is named or anything is saved, while real runs — including
// a run where only one option is scored — behave exactly as before.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/ethics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ethics.${name}`);
  if (!fn) throw new Error(`ethics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "w1" }, userId: "w1" };
const count = () => call("listDecisionMatrices", ctx, {}).result.matrices.length;

describe("FIX-ethics-012 decision matrix validation", () => {
  it("the walker's junk run (one option, no scores) is refused and not persisted", () => {
    const r = call("decisionMatrix", ctx, {
      title: "bad run",
      criteria: [{ name: "x", weight: 1 }],
      options: [{ name: "d", scores: { x: 0 } }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /no scores has no winner/);
    assert.equal(count(), 0);
  });

  it("a run with every criterion weight at 0 is refused and not persisted", () => {
    const r = call("decisionMatrix", ctx, {
      title: "zero weights",
      criteria: [{ name: "x", weight: 0 }],
      options: [{ name: "d", scores: { x: 9 } }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /weight above 0/);
    assert.equal(count(), 0);
  });

  it("missing scores objects entirely are refused the same way", () => {
    const r = call("decisionMatrix", ctx, {
      criteria: [{ name: "x", weight: 1 }],
      options: [{ name: "d" }, { name: "e" }],
    });
    assert.equal(r.ok, false);
    assert.equal(count(), 0);
  });

  it("a real run still crowns the higher-scored option and persists", () => {
    const r = call("decisionMatrix", ctx, {
      title: "real",
      criteria: [{ name: "x", weight: 1 }],
      options: [{ name: "A", scores: { x: 3 } }, { name: "B", scores: { x: 8 } }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "B");
    assert.equal(count(), 1);
  });

  it("a run where only one option is scored still works (the other scores 0)", () => {
    const r = call("decisionMatrix", ctx, {
      criteria: [{ name: "x", weight: 1 }],
      options: [{ name: "A", scores: {} }, { name: "B", scores: { x: 5 } }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "B");
  });
});
