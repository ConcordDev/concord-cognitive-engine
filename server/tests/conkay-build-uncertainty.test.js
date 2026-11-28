// How sure the checks are. Expected values are closed form: with strength the
// only scattered input, utilization u = u0 / s with s lognormal (mean 1, CoV V),
// so P(u > 1) = Φ((ln u0 + σ²/2) / σ), σ² = ln(1 + V²), and median(u) = u0·e^{σ²/2}.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import "../lib/conkay/index.js";
import { propagate, DEFAULT_SCATTER } from "../lib/conkay/build/uncertainty.js";
import { buildFromBrief, saveBuild, uncertaintyForSavedBuild } from "../lib/conkay/build/index.js";
import { up as migrate518 } from "../migrations/518_conkay_builds.js";

// Φ via erf (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7)
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

const pine = (category) => ({ "white-pine": { label: "Eastern white pine", ...(category ? { category } : {}), density: { value: "350 kg/m3", source: "OpenStax University Physics 1, Table 14.1" }, youngsModulus: { value: "8.5 GPa", source: "USDA Wood Handbook" }, poisson: { value: 0.33, source: "USDA Wood Handbook" }, yield: { value: "33 MPa", source: "USDA Wood Handbook (MOR)" } } });
const shelf = (h = "8.7 mm", category) => ({ design: { id: "shelf", name: "wall shelf" }, materials: pine(category),
  nodes: [
    { id: "SHELF", kind: "Assembly", name: "wall shelf", props: { frameModel: { nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: "3 ft", y: 0, z: 0 }], members: [{ id: "M1", i: "A", j: "B", part: "BOARD" }],
      supports: [{ node: "A", fix: ["x", "y", "z", "rx"] }, { node: "B", fix: ["y", "z"] }], loadCases: [{ id: "books", udl: [{ member: "M1", w: [0, 0, "-24.3 lbf/ft"] }] }], factorOfSafety: { value: 2, basis: "the person" } } } },
    { id: "BOARD", kind: "Part", name: "board", material: "white-pine", position: { x: "1.5 ft", y: 0, z: 0 }, geometry: { shape: "box", length: "3 ft", width: "10 in", height: h } }],
  edges: [{ from: "SHELF", to: "BOARD", type: "CONTAINS" }] });
const bending = (r) => r.checks.find((c) => /von Mises/.test(c.check));

test("strength scatter alone: the probability of failure matches the lognormal closed form", async () => {
  const V = 0.25;
  const r = await propagate(shelf(), { samples: 3000, loadCoV: 0, dimensionCoV: 0, scatter: { "white-pine": { strength: V, source: "JCSS PMC 3.05" } } });
  assert.equal(r.ok, true);
  const c = bending(r);
  const u0 = c.nominalUtilization, s2 = Math.log(1 + V * V), s = Math.sqrt(s2);
  const exact = Phi((Math.log(u0) + s2 / 2) / s);
  assert.ok(exact > 0.05 && exact < 0.15, `a design near its limit (${exact})`);
  assert.ok(c.probabilityNotMet.low <= exact && exact <= c.probabilityNotMet.high, `exact ${exact} inside the 95 % interval [${c.probabilityNotMet.low}, ${c.probabilityNotMet.high}]`);
  assert.ok(Math.abs(c.utilization.p50 - u0 * Math.exp(s2 / 2)) <= 0.02 * u0, "median u0·e^{σ²/2}");
  assert.equal(c.driver.input, "Eastern white pine strength");
  assert.ok(c.driver.correlation < -0.9, "stronger wood, lower utilization");
});

test("seeded: the same seed repeats exactly; another seed differs", async () => {
  const o = { samples: 200, scatter: { "white-pine": { strength: 0.25 } } };
  const a = await propagate(shelf(), { ...o, seed: 7 }), b = await propagate(shelf(), { ...o, seed: 7 }), c = await propagate(shelf(), { ...o, seed: 8 });
  assert.deepEqual(a.checks, b.checks);
  assert.notDeepEqual(a.checks, c.checks);
});

test("a material with no sourced scatter is not varied and says so; a stated category gets its sourced default", async () => {
  const none = await propagate(shelf(), { samples: 100 });
  assert.match(none.warnings.join(" "), /white pine: not varied/);
  assert.ok(!none.inputs.some((i) => /strength/.test(i.input)));
  const wood = await propagate(shelf("8.7 mm", "wood"), { samples: 100 });
  const str = wood.inputs.find((i) => /strength/.test(i.input));
  assert.equal(str.cov, DEFAULT_SCATTER.wood.strength);
  assert.match(str.source, /JCSS Probabilistic Model Code Part 3\.05/);
  assert.match(wood.inputs.find((i) => /spread load/.test(i.input)).source, /assumed load scatter/);
});

test("nothing fails in N samples: the upper bound is the exact one-sided 95 % bound, not zero", async () => {
  const r = await propagate(shelf("3/4 in"), { samples: 500 });
  const c = bending(r);
  assert.equal(c.failures, 0);
  assert.equal(c.probabilityNotMet.zeroFailures, true);
  assert.ok(Math.abs(c.probabilityNotMet.high - (1 - 0.05 ** (1 / 500))) < 1e-15);
});

test("without the safety factor: utilization exactly halves for FS 2 (the chance a part really breaks)", async () => {
  const kept = await propagate(shelf(), { samples: 50 });
  const real = await propagate(shelf(), { samples: 50, withoutSafetyFactors: true });
  assert.ok(Math.abs(bending(real).nominalUtilization - bending(kept).nominalUtilization / 2) < 1e-3);
  assert.match(real.mode, /actually fails/);
});

test("refuses what it cannot do", async () => {
  assert.match((await propagate(shelf(), { samples: 5 })).error, /samples/);
  assert.match((await propagate(shelf(), { scatter: { "white-pine": { strength: 3 } } })).error, /coefficient of variation/);
  assert.match((await propagate(shelf(), { loadCoV: -1 })).error, /loadCoV/);
  const noFs = shelf(); delete noFs.nodes[0].props.frameModel.factorOfSafety;
  assert.match((await propagate(noFs, { withoutSafetyFactors: true })).error, /no safety factor/);
});

test("a saved build: both runs, read-only, and only for its owner", async () => {
  const db = new Database(":memory:"); migrate518(db);
  const plan = { summary: "a pine wall shelf", ir: shelf("3/4 in", "wood"), lookups: [], questions: [], assumptions: [] };
  const built = await buildFromBrief({ brief: "a 3 ft pine shelf", chat: async () => ({ ok: true, text: JSON.stringify(plan) }), lookup: null, settle: false });
  const id = saveBuild(db, { userId: "u1", brief: "a 3 ft pine shelf", answers: [], result: built });
  const r = await uncertaintyForSavedBuild(db, { id, userId: "u1", samples: 100 });
  assert.equal(r.ok, true);
  assert.ok(r.asWritten.checks.length && r.withoutSafetyFactors.checks.length);
  assert.ok(bending(r.withoutSafetyFactors).nominalUtilization < bending(r.asWritten).nominalUtilization);
  assert.equal((await uncertaintyForSavedBuild(db, { id, userId: "intruder" })).error, "not_found");
});

test("Kay's tool: she asks the solvers how sure it is, for this person's build only", async () => {
  const { executeToolCall } = await import("../lib/chat-agent.js");
  const db = new Database(":memory:"); migrate518(db);
  const plan = { summary: "a pine wall shelf", ir: shelf("8.7 mm", "wood"), lookups: [], questions: [], assumptions: [] };
  const built = await buildFromBrief({ brief: "a 3 ft pine shelf", chat: async () => ({ ok: true, text: JSON.stringify(plan) }), lookup: null, settle: false });
  const id = saveBuild(db, { userId: "u1", brief: "a 3 ft pine shelf", answers: [], result: built });
  const r = await executeToolCall({ db, userId: "u1" }, null, new Map(), { tool: "conkay_build_uncertainty", params: { buildId: id, loadCoV: 0.2, samples: 200 } });
  assert.equal(r.ok, true, r.error);
  const c = r.result.asWritten.checks.find((x) => /von Mises/.test(x.check));
  assert.ok(c.probabilityNotMet.p > 0, "timber scatter near its limit: some samples fail");
  assert.ok(r.result.asWritten.varied.some((v) => /spread load.*CoV 0\.2 \(stated by the person\)/.test(v)));
  assert.ok(r.result.withoutSafetyFactors.checks.length);
  const other = await executeToolCall({ db, userId: "intruder" }, null, new Map(), { tool: "conkay_build_uncertainty", params: { buildId: id } });
  assert.equal(other.ok, false);
});
