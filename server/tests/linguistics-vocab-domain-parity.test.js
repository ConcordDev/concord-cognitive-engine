// Contract tests for the linguistics lens — vocabulary builder
// substrate in server/domains/linguistics.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLinguisticsActions from "../domains/linguistics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`linguistics.${name}`);
  assert.ok(fn, `linguistics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLinguisticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // vocab-add auto-fetches a definition when none is supplied — disable
  // the network so these contract tests stay deterministic and offline.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("linguistics.vocab CRUD", () => {
  it("adds a word scoped per user", async () => {
    await call("vocab-add", ctxA, { word: "Petrichor", definition: "the smell of rain on dry earth" });
    assert.equal(call("vocab-list", ctxA, {}).result.count, 1);
    assert.equal(call("vocab-list", ctxB, {}).result.count, 0);
  });
  it("rejects an empty or duplicate word", async () => {
    assert.equal((await call("vocab-add", ctxA, {})).ok, false);
    await call("vocab-add", ctxA, { word: "ephemeral", definition: "lasting briefly" });
    assert.equal((await call("vocab-add", ctxA, { word: "Ephemeral", definition: "x" })).ok, false); // case-insensitive dup
  });
  it("updates and deletes a word", async () => {
    const w = (await call("vocab-add", ctxA, { word: "limn", definition: "tmp" })).result.word;
    call("vocab-update", ctxA, { id: w.id, definition: "to depict or describe" });
    assert.equal(call("vocab-list", ctxA, {}).result.words[0].definition, "to depict or describe");
    call("vocab-delete", ctxA, { id: w.id });
    assert.equal(call("vocab-list", ctxA, {}).result.count, 0);
  });
  it("filters vocab-list by tag", async () => {
    await call("vocab-add", ctxA, { word: "a", definition: "x", tags: ["latin"] });
    await call("vocab-add", ctxA, { word: "b", definition: "y", tags: ["greek"] });
    assert.equal(call("vocab-list", ctxA, { tag: "latin" }).result.count, 1);
  });
});

describe("linguistics.vocab spaced review", () => {
  it("a new word is due immediately", async () => {
    await call("vocab-add", ctxA, { word: "quotidian", definition: "daily" });
    assert.equal(call("vocab-review-due", ctxA, {}).result.count, 1);
  });
  it("knowing a word promotes its level and pushes the due date out", async () => {
    const w = (await call("vocab-add", ctxA, { word: "sonder", definition: "x" })).result.word;
    const r = call("vocab-review", ctxA, { id: w.id, known: true });
    assert.equal(r.result.level, 1);
    assert.equal(r.result.nextReviewInDays, 1);
    assert.equal(call("vocab-review-due", ctxA, {}).result.count, 0); // no longer due
  });
  it("missing a word resets it to level 0", async () => {
    const w = (await call("vocab-add", ctxA, { word: "apricity", definition: "x" })).result.word;
    call("vocab-review", ctxA, { id: w.id, known: true });
    call("vocab-review", ctxA, { id: w.id, known: true });
    const miss = call("vocab-review", ctxA, { id: w.id, known: false });
    assert.equal(miss.result.level, 0);
  });
});

describe("linguistics.vocab-dashboard", () => {
  it("aggregates mastery buckets", async () => {
    const w1 = (await call("vocab-add", ctxA, { word: "one", definition: "x" })).result.word;
    await call("vocab-add", ctxA, { word: "two", definition: "y" });
    for (let i = 0; i < 5; i++) call("vocab-review", ctxA, { id: w1.id, known: true });
    const d = call("vocab-dashboard", ctxA, {});
    assert.equal(d.result.totalWords, 2);
    assert.equal(d.result.mastered, 1);
    assert.equal(d.result.fresh, 1);
  });
});

describe("linguistics — analysis macros still intact", () => {
  it("textAnalysis still responds", () => {
    assert.equal(call("textAnalysis", ctxA, {}).ok, true);
  });
});
