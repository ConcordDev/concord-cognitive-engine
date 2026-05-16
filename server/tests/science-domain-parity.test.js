import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/science.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`science.${name}`);
  if (!fn) throw new Error(`science.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("science — descriptive stats", () => {
  it("computes mean=5.5 median=5.5 for 1..10", () => {
    const r = call("stats-descriptive", ctxA, { data: [1,2,3,4,5,6,7,8,9,10] });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 10);
    assert.equal(r.result.mean, 5.5);
    assert.equal(r.result.median, 5.5);
    assert.equal(r.result.min, 1);
    assert.equal(r.result.max, 10);
  });

  it("computes correct sd for [2,4,4,4,5,5,7,9] = 2.138", () => {
    const r = call("stats-descriptive", ctxA, { data: [2,4,4,4,5,5,7,9] });
    assert.ok(Math.abs(r.result.sd - 2.138) < 0.01);
  });

  it("rejects empty data", () => {
    const r = call("stats-descriptive", ctxA, { data: [] });
    assert.equal(r.ok, false);
  });

  it("rejects single value (no variance possible)", () => {
    const r = call("stats-descriptive", ctxA, { data: [42] });
    assert.equal(r.ok, false);
  });
});

describe("science — t-test", () => {
  it("two-sample t-test detects significant difference", () => {
    const r = call("stats-ttest", ctxA, {
      kind: "two-sample",
      a: [5,7,8,4,6,9,5,7],
      b: [10,12,11,14,13,11,12,13],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.significantAt05, true);
    assert.ok(Math.abs(r.result.t) > 2);
  });

  it("two-sample t-test does not flag identical means", () => {
    const r = call("stats-ttest", ctxA, {
      kind: "two-sample",
      a: [5, 5, 5, 5, 5],
      b: [5, 5, 5, 5, 5],
    });
    // Both stddevs are 0 — undefined t, but should not crash
    assert.equal(r.ok, true);
  });

  it("one-sample t-test", () => {
    const r = call("stats-ttest", ctxA, {
      kind: "one-sample",
      a: [10, 12, 11, 13, 14, 12, 11],
      mu: 12,
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.sampleMean - 11.857) < 0.01);
  });

  it("rejects sample with < 2 values", () => {
    const r = call("stats-ttest", ctxA, { kind: "two-sample", a: [5], b: [1,2,3] });
    assert.equal(r.ok, false);
  });
});

describe("science — correlation + linear regression", () => {
  it("perfect linear y=2x correlation r ≈ 1", () => {
    const r = call("stats-correlation", ctxA, {
      x: [1,2,3,4,5,6,7,8,9,10],
      y: [2,4,6,8,10,12,14,16,18,20],
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.pearsonR - 1) < 0.001);
    assert.ok(Math.abs(r.result.slope - 2) < 0.001);
    assert.ok(Math.abs(r.result.intercept) < 0.001);
  });

  it("negative correlation y=-x → r ≈ -1", () => {
    const r = call("stats-correlation", ctxA, {
      x: [1, 2, 3, 4, 5],
      y: [-1, -2, -3, -4, -5],
    });
    assert.ok(Math.abs(r.result.pearsonR + 1) < 0.001);
  });

  it("rejects mismatched lengths", () => {
    const r = call("stats-correlation", ctxA, { x: [1, 2, 3], y: [1, 2] });
    assert.equal(r.ok, false);
  });

  it("rejects fewer than 3 pairs", () => {
    const r = call("stats-correlation", ctxA, { x: [1, 2], y: [1, 2] });
    assert.equal(r.ok, false);
  });
});

describe("science — dataset storage", () => {
  it("save + list", () => {
    call("dataset-save", ctxA, { name: "Test", columns: ["x", "y"], rows: [[1, 2], [3, 4]] });
    const r = call("dataset-list", ctxA);
    assert.equal(r.result.datasets.length, 1);
    assert.equal(r.result.datasets[0].rowCount, 2);
  });

  it("INVARIANT: scoped per-user", () => {
    call("dataset-save", ctxA, { name: "a-only", columns: ["x"], rows: [[1]] });
    const b = call("dataset-list", ctxB);
    assert.equal(b.result.datasets.length, 0);
  });
});
