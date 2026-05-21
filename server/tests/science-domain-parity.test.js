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

  it("dataset-update + dataset-get round-trip", () => {
    const created = call("dataset-save", ctxA, { name: "Grid", columns: ["a"], rows: [[1]] });
    const id = created.result.dataset.id;
    const upd = call("dataset-update", ctxA, { id, columns: ["a", "b"], rows: [[1, 2], [3, 4]] });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.dataset.columns.length, 2);
    const got = call("dataset-get", ctxA, { id });
    assert.equal(got.result.dataset.rows.length, 2);
  });
});

describe("science — chart-render", () => {
  it("bar chart returns x/y series points", () => {
    const r = call("chart-render", ctxA, {
      kind: "bar", columns: ["label", "value"],
      rows: [["a", 3], ["b", 7], ["c", 5]],
      xColumn: "label", yColumn: "value",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "bar");
    assert.equal(r.result.points.length, 3);
    assert.equal(r.result.xKey, "label");
  });

  it("histogram buckets numeric values", () => {
    const r = call("chart-render", ctxA, {
      kind: "histogram", columns: ["v"],
      rows: [[1], [2], [3], [4], [5], [6], [7], [8]],
      valueColumn: "v", bins: 4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.bins, 4);
    assert.equal(r.result.points.reduce((s, b) => s + b.count, 0), 8);
  });

  it("pie chart counts categories", () => {
    const r = call("chart-render", ctxA, {
      kind: "pie", columns: ["cat"],
      rows: [["x"], ["x"], ["y"]],
      categoryColumn: "cat",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.slices.find((s) => s.name === "x").count, 2);
  });

  it("rejects unknown chart kind", () => {
    const r = call("chart-render", ctxA, { kind: "spiral", columns: ["a"], rows: [[1]] });
    assert.equal(r.ok, false);
  });
});

describe("science — richer statistics", () => {
  it("one-way ANOVA detects group difference", () => {
    const r = call("stats-anova", ctxA, {
      groups: [[1, 2, 3, 2], [8, 9, 10, 9], [15, 16, 14, 15]],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.significantAt05, true);
    assert.ok(r.result.fStatistic > 1);
  });

  it("ANOVA rejects < 2 groups", () => {
    const r = call("stats-anova", ctxA, { groups: [[1, 2, 3]] });
    assert.equal(r.ok, false);
  });

  it("linear regression yields slope CI", () => {
    const r = call("stats-regression", ctxA, {
      x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10],
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.slope - 2) < 0.001);
    assert.equal(r.result.slopeCI95.length, 2);
  });

  it("Mann-Whitney U non-parametric test", () => {
    const r = call("stats-nonparametric", ctxA, {
      test: "mann-whitney", a: [1, 2, 3, 4], b: [10, 11, 12, 13],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.test, "mann-whitney-u");
    assert.equal(r.result.significantAt05, true);
  });

  it("confidence interval brackets the mean", () => {
    const r = call("stats-ci", ctxA, { data: [10, 12, 11, 13, 14, 12], confidence: 0.95 });
    assert.equal(r.ok, true);
    assert.ok(r.result.lower < r.result.mean);
    assert.ok(r.result.upper > r.result.mean);
  });
});

describe("science — notebook entries", () => {
  it("add + list + update + delete", () => {
    const add = call("notebook-add", ctxA, {
      title: "Day 1", body: "Set up apparatus.", tags: ["setup"],
      attachments: [{ kind: "dataset", ref: "ds_1", label: "raw" }],
    });
    assert.equal(add.ok, true);
    const id = add.result.entry.id;
    const upd = call("notebook-update", ctxA, { id, body: "Updated notes." });
    assert.equal(upd.result.entry.body, "Updated notes.");
    const list = call("notebook-list", ctxA);
    assert.equal(list.result.count, 1);
    const del = call("notebook-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("notebook-list", ctxA).result.count, 0);
  });

  it("rejects empty title", () => {
    const r = call("notebook-add", ctxA, { title: "" });
    assert.equal(r.ok, false);
  });
});

describe("science — protocol run log", () => {
  it("start → step → complete lifecycle", () => {
    const start = call("protorun-start", ctxA, {
      protocolName: "PCR Setup", steps: ["Prep", "Run", "Cleanup"],
    });
    assert.equal(start.ok, true);
    const id = start.result.run.id;
    const step = call("protorun-step", ctxA, { id, stepIndex: 0, status: "completed" });
    assert.equal(step.result.run.steps[0].status, "completed");
    assert.equal(step.result.run.currentStep, 1);
    const done = call("protorun-complete", ctxA, { id, outcome: "Success" });
    assert.equal(done.result.run.status, "completed");
    assert.equal(call("protorun-list", ctxA).result.count, 1);
    call("protorun-delete", ctxA, { id });
    assert.equal(call("protorun-list", ctxA).result.count, 0);
  });

  it("rejects run with no steps", () => {
    const r = call("protorun-start", ctxA, { protocolName: "X", steps: [] });
    assert.equal(r.ok, false);
  });
});

describe("science — reagent inventory", () => {
  it("save → consume → list reflects depletion + low stock", () => {
    const save = call("reagent-save", ctxA, {
      name: "Ethanol", quantity: 100, unit: "mL", reorderThreshold: 20,
    });
    assert.equal(save.ok, true);
    const id = save.result.reagent.id;
    const consume = call("reagent-consume", ctxA, { id, amount: 85, reason: "extraction" });
    assert.equal(consume.result.reagent.quantity, 15);
    assert.equal(consume.result.reagent.lowStock, true);
    const list = call("reagent-list", ctxA);
    assert.equal(list.result.lowStockCount, 1);
    call("reagent-delete", ctxA, { id });
    assert.equal(call("reagent-list", ctxA).result.count, 0);
  });

  it("rejects consuming more than in stock", () => {
    const save = call("reagent-save", ctxA, { name: "Saline", quantity: 10 });
    const r = call("reagent-consume", ctxA, { id: save.result.reagent.id, amount: 50 });
    assert.equal(r.ok, false);
  });
});

describe("science — publication export", () => {
  it("builds a markdown manuscript bundle", () => {
    const r = call("publication-export", ctxA, {
      title: "A Study of X",
      authors: ["Lee", "Park"],
      abstract: "We investigate X.",
      methods: "Standard procedure.",
      results: "X increased.",
      figures: [{ caption: "Trend", chartKind: "line", ref: "fig1" }],
      format: "markdown",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.equal(r.result.figureCount, 1);
    assert.ok(typeof r.result.bundle === "string");
    assert.ok(r.result.bundle.includes("# A Study of X"));
  });

  it("rejects missing title", () => {
    const r = call("publication-export", ctxA, { title: "" });
    assert.equal(r.ok, false);
  });
});
