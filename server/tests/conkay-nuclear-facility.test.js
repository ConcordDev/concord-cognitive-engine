// tests/conkay-nuclear-facility.test.js
//
// Nuclear Phase 3: facility SSC skeleton of the NRC-certified NuScale US600
// (public sources only) linked to the Phase 1 safety-case graph and the Phase 2
// FTA / ETA engine, with facility-level cross-system checks. A generic toy
// facility (illustrative, not a plant) pins the check logic itself; the US600
// tests pin provenance, the findings and the screening-only vocabulary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../lib/conkay/index.js";
import {
  buildUS600Facility, runFacilityScreen, renderFacilityMarkdown, validateFacility, facilitySupportSystem, allTrainSupports, sharedExposure,
  US600_SOURCES, US600_FACTS, forbiddenVerdicts, INITIATOR_DATA, BANNER,
} from "../lib/conkay/safety-case/index.js";
import registerConkaySafetyActions from "../domains/conkay-safety.js";

// Generic toy facility (illustrative; not any plant): two modules, each with a 1-of-2 function whose trains need a
// per-train pump; both pumps of module 1 are (deliberately) fed from one shared bus; module 2 is correct. A shared
// tank feeds every train of both modules; a shared signal cabinet only actuates (fail-safe).
function toyFacility({ sharedBusFault = true } = {}) {
  const src = { toy: { title: "toy", url: "https://example.invalid/toy", quality: "primary" } };
  const f = (id) => ({ id, source: "toy", locator: "toy", quote: "toy", verbatim: true, quality: "primary" });
  const facts = { a: f("F-toy") };
  const ssc = [{ id: "TANK", name: "shared tank", kind: "ultimate-heat-sink", scope: "shared", facts: ["F-toy"] }, { id: "SIG", name: "shared signal cabinet", kind: "ic", scope: "shared", facts: ["F-toy"] }];
  const deps = [];
  const functions = [];
  for (const m of [1, 2]) {
    for (const b of ["A", "B"]) ssc.push({ id: `M${m}:BUS-${b}`, name: "bus", kind: "power", scope: "per-module", facts: ["F-toy"] });
    const trains = [];
    for (const t of ["A", "B"]) {
      const p = `M${m}:PUMP-${t}`;
      ssc.push({ id: p, name: "pump", kind: "pump", scope: "per-module", facts: ["F-toy"] });
      const bus = sharedBusFault && m === 1 ? `M${m}:BUS-A` : `M${m}:BUS-${t}`;
      deps.push({ from: p, to: bus, type: "requires", facts: ["F-toy"] }, { from: p, to: "TANK", type: "requires", facts: ["F-toy"] }, { from: p, to: "SIG", type: "fail-safe", facts: ["F-toy"] });
      trains.push({ id: `M${m}:T-${t}`, components: [p] });
    }
    functions.push({ id: `M${m}:SF`, name: "toy function", module: m, trains, successCriterion: { k: 1 } });
  }
  return { design: { id: "toy", name: "toy facility (illustrative)" }, sources: src, facts, ssc, dependencies: deps, functions, conflicts: [], gaps: [] };
}

describe("cross-system checks on a generic toy facility (logic benchmark)", () => {
  it("finds the injected shared bus in module 1 only, the shared tank across modules, and never treats a fail-safe edge as a defeat", () => {
    const r = runFacilityScreen(toyFacility());
    assert.equal(r.ok, true, r.errors?.join("; "));
    const cc = r.phase1.independence.filter((x) => x.kind === "common-cause-trains").map((x) => `${x.support}>${x.function}`).sort();
    assert.deepEqual(cc, ["M1:BUS-A>M1:SF", "TANK>M1:SF", "TANK>M2:SF"]);
    assert.ok(r.phase1.independence.some((x) => x.kind === "cross-function" && x.support === "TANK"));
    const sig = r.crossSystem.sharedExposure.find((x) => x.ssc === "SIG");
    assert.deepEqual([sig.functionsWithATrainDependingOnIt, sig.modulesActuatedOnItsLoss], [[], [1, 2]]);
    assert.deepEqual(r.crossSystem.failSafe.find((x) => x.support === "SIG").trainsDefeated, []);
  });
  it("is clean once the bus is separated, except for the shared tank (which needs a disposition)", () => {
    const r = runFacilityScreen(toyFacility({ sharedBusFault: false }));
    assert.deepEqual([...new Set(r.phase1.independence.map((x) => x.support))], ["TANK"]);
    assert.deepEqual(r.crossSystem.dispositions.map((d) => [d.support, d.passive]), [["TANK", true]]);
  });
  it("covers functions with an unknown success criterion through supports shared by every train", () => {
    const fac = toyFacility({ sharedBusFault: false });
    fac.functions[1].successCriterion = { unknown: true, gap: "G-x" };
    const { sys, excluded } = facilitySupportSystem(fac);
    assert.deepEqual(excluded.map((e) => e.function), ["M2:SF"]);
    assert.deepEqual(allTrainSupports(fac, sys).filter((a) => a.function === "M2:SF").map((a) => a.support), ["TANK"]);
  });
  it("refuses an SSC or dependency without a quoted source", () => {
    const fac = toyFacility();
    fac.ssc[0].facts = [];
    fac.dependencies[0].facts = ["F-missing"];
    const errs = validateFacility(fac);
    assert.ok(errs.some((e) => /TANK has no source fact/.test(e)) && errs.some((e) => /unknown fact F-missing/.test(e)));
  });
});

describe("NuScale US600 facility skeleton (public sources)", () => {
  const fac = buildUS600Facility();
  const r = runFacilityScreen(fac);
  it("cites only public sources, quotes every fact with a locator, and labels primary vs secondary", () => {
    assert.deepEqual(validateFacility(fac), []);
    assert.equal(US600_SOURCES["fr-2023-00729"].quality, "primary");
    assert.match(US600_SOURCES["fr-2023-00729"].url, /^https:\/\/www\.govinfo\.gov\//);
    assert.equal(US600_SOURCES["frontiers-2023"].quality, "secondary");
    for (const f of Object.values(US600_FACTS)) assert.ok(f.quote.length > 20 && f.locator && f.verbatim, f.id);
    assert.equal(fac.design.modules, 12);
    assert.match(US600_FACTS.rating.quote, /12 power modules/);
    assert.throws(() => buildUS600Facility({ modules: 13 }), /1\.\.12/);
  });
  it("keeps the source conflict (3 vs 2 reactor vent valves) and the gaps as review items, not merged", () => {
    const rvv = fac.ssc.filter((s) => /^M1:RVV\d$/.test(s.id));
    assert.equal(rvv.length, 3, "primary source");
    assert.ok(r.reviewQueue.some((q) => q.kind === "source-conflict" && q.id === "C-rvv-count" && q.decision === "pending_human_review"));
    assert.ok(r.reviewQueue.some((q) => q.kind === "gap" && q.id === "G-eccs-success"));
    assert.ok(r.reviewQueue.some((q) => q.kind === "excluded-from-k-of-n" && q.id === "M1:SF-ECCS"));
  });
  it("finds the shared pool and reactor building across all 12 modules and classifies them as passive shared SSCs for disposition", () => {
    const xf = r.phase1.independence.filter((x) => x.kind === "cross-function").map((x) => [x.support, x.functionsLost.length]);
    assert.deepEqual(xf.sort(), [["POOL", 12], ["RXB", 12]]);
    const pool = r.crossSystem.sharedExposure.find((x) => x.ssc === "POOL");
    assert.equal(pool.modulesWhoseFunctionsItSupports.length, 12);
    assert.ok(r.crossSystem.dispositions.every((d) => d.passive && d.decision === "pending_human_review"));
    assert.ok(r.crossSystem.allTrainSupports.some((a) => a.function === "M7:SF-ECCS" && a.support === "POOL" && a.successCriterion === "unknown"));
  });
  it("loss of electrical power actuates every module's functions and defeats none (fail-safe, as sourced)", () => {
    const elec = r.crossSystem.sharedExposure.find((x) => x.ssc === "ELEC");
    assert.equal(elec.modulesActuatedOnItsLoss.length, 12);
    assert.deepEqual(elec.functionsWithATrainDependingOnIt, []);
    assert.ok(r.crossSystem.failSafe.every((x) => x.trainsDefeated.length === 0));
  });
  it("links to Phase 2: cut sets from the same graph, LOOP frequency from NUREG/CR-6928, nothing quantified without data", () => {
    const p = r.phase2;
    assert.deepEqual(p.cutSets.filter((c) => c.length === 1).map((c) => c[0]).sort(), ["POOL", "RXB"]);
    assert.equal(p.cutSets.filter((c) => c.length === 2).length, 4);
    assert.equal(p.quantified, false);
    assert.equal(p.blockedBy.length, p.basicEvents.length);
    assert.equal(p.eventTree.frequency.mean, INITIATOR_DATA["PO.LOOP"].mean);
    assert.equal(p.eventTree.sequenceFrequencies, null);
  });
  it("links to Phase 1 requirements: findings fail the screening criterion, roles stay unassigned, the change log verifies", () => {
    for (const q of r.requirements) {
      assert.equal(q.status.status, "screening_fail");
      for (const f of ["owner", "reviewer", "verification"]) assert.ok(q.status.missing.some((m) => m.field === f), `${q.status.id} ${f}`);
    }
    assert.equal(r.changeLog.verification.valid, true);
  });
  it("is screening only and deterministic", () => {
    assert.deepEqual(forbiddenVerdicts(r), []);
    assert.equal(r.banner, BANNER);
    assert.equal(runFacilityScreen(buildUS600Facility()).phase1.receipt, r.phase1.receipt);
    assert.ok(renderFacilityMarkdown(r).includes(BANNER));
  });
  it("is served as conkay_safety.facility-us600", () => {
    const actions = {};
    registerConkaySafetyActions((d, n, fn) => { actions[`${d}.${n}`] = fn; });
    const a = actions["conkay_safety.facility-us600"](null, null, { modules: 2 });
    assert.equal(a.ok, true);
    assert.equal(a.result.design.modules, 2);
    assert.equal(actions["conkay_safety.facility-us600"](null, null, { modules: 20 }).ok, false);
  });
});
