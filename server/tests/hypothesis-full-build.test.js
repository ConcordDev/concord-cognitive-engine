// Hypothesis full-build pins (S5 calibration · S4 duplicates + delete ·
// S2 canonical promotion · S3 the battery↔Lab join).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../emergent/hypothesis-engine.js";
import registerHypothesisActions from "../domains/hypothesis.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`hypothesis.${name}`);
  if (!fn) throw new Error(`hypothesis.${name} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}
before(() => { registerHypothesisActions(register); });
let uidCounter = 0;
let ctx;
beforeEach(() => { ctx = { userId: `user_${++uidCounter}` }; });

describe("hypothesis S5 — confidence calibration", () => {
  it("one 0.5-weight supporting item yields 0.60, not 1.00", () => {
    const p = engine.proposeHypothesis("Calib fixture A", "test", "normal", { force: true });
    assert.equal(p.ok, true);
    const id = p.hypothesis.id;
    engine.addEvidence(id, "for", null, 0.5, "pilot note");
    const h = engine.getHypothesis(id);
    assert.equal(h.machine.hypothesis.confidence, 0.6);
  });
  it("the published model rides the metrics", () => {
    const m = engine.getHypothesisMetrics();
    assert.equal(m.ok, true);
    assert.ok(m.confidenceModel && m.confidenceModel.priorWeight === 2);
    assert.match(m.confidenceModel.formula, /forWeight \+ 1/);
  });
});

describe("hypothesis S4 — duplicates + delete", () => {
  it("an exact duplicate statement refuses with the match named; force re-proposes", () => {
    const a = engine.proposeHypothesis("Duplicate fixture statement", "test", "normal", { force: true });
    assert.equal(a.ok, true);
    const dup = engine.proposeHypothesis("  duplicate   fixture statement ", "test", "normal");
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_statement");
    assert.equal(dup.duplicateOf.id, a.hypothesis.id);
    const forced = engine.proposeHypothesis("Duplicate fixture statement", "test", "normal", { force: true });
    assert.equal(forced.ok, true);
  });
  it("delete removes a live hypothesis; a confirmed one refuses (Fact source)", () => {
    const a = engine.proposeHypothesis("Delete fixture", "test", "normal", { force: true });
    const id = a.hypothesis.id;
    const del = engine.deleteHypothesis(id);
    assert.equal(del.ok, true);
    assert.equal(engine.getHypothesis(id), null);

    globalThis._concordSTATE = { dtus: new Map() };
    const b = engine.proposeHypothesis("Confirm fixture", "test", "normal", { force: true });
    const bid = b.hypothesis.id;
    const conf = engine.confirmHypothesis(bid);
    assert.equal(conf.ok, true);
    const refused = engine.deleteHypothesis(bid);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "confirmed_hypothesis_is_fact_source");
  });
});

describe("hypothesis S2 — promotion lands in the canonical DTU store", () => {
  it("confirm writes a public Fact DTU keyed by the returned id, with provenance", () => {
    globalThis._concordSTATE = { dtus: new Map() };
    const a = engine.proposeHypothesis("Promotion fixture", "test", "normal", { force: true });
    const id = a.hypothesis.id;
    const conf = engine.confirmHypothesis(id);
    assert.equal(conf.ok, true);
    assert.ok(conf.factDtuId, "confirm returns the fact id");
    const dtu = globalThis._concordSTATE.dtus.get(conf.factDtuId);
    assert.ok(dtu, "the Fact is in the canonical store");
    assert.equal(dtu.machine.kind, "fact");
    assert.equal(dtu.machine.sourceHypothesisId, id);
    assert.equal(dtu.visibility, "public");
    assert.equal(dtu.domain, "hypothesis");
  });
});

describe("hypothesis S3 — dataset runs record on a linked hypothesis", () => {
  it("import with a link, run ANOVA, the hypothesis gains a test record", () => {
    const a = engine.proposeHypothesis("Join fixture", "test", "normal", { force: true });
    const hid = a.hypothesis.id;
    const imp = call("datasetImport", ctx, {
      name: "linked",
      csv: "group,score\nA,1\nA,2\nA,3\nB,10\nB,11\nB,12",
      hypothesisId: hid,
    });
    assert.equal(imp.ok, true);
    const run = call("runTestOnDataset", ctx, {
      datasetId: imp.result.id, test: "anova", groupColumn: "group", valueColumn: "score",
    });
    assert.equal(run.ok, true);
    assert.ok(run.attachedToHypothesis, "the run reports its attachment");
    assert.equal(run.attachedToHypothesis.hypothesisId, hid);
    const h = engine.getHypothesis(hid);
    const tests = h.machine.hypothesis.tests;
    assert.equal(tests.length, 1);
    assert.match(tests[0].description, /Dataset test: anova/);
    assert.equal(tests[0].status, run.attachedToHypothesis.verdict);
  });
  it("an unlinked dataset run attaches nothing", () => {
    const imp = call("datasetImport", ctx, {
      name: "unlinked",
      csv: "x,y\n1,2\n2,4\n3,6",
    });
    const run = call("runTestOnDataset", ctx, {
      datasetId: imp.result.id, test: "correlation", columns: ["x", "y"],
    });
    assert.equal(run.ok, true);
    assert.equal(run.attachedToHypothesis, undefined);
  });
});
