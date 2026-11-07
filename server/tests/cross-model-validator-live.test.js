// Cohesive R-3 — the LIVE enrolment: Design IR documents produced by
// shipped code, validated against the real solver registry.
//
// Corpus: the Sentinel M1 demo IR (lib/conkay/demos/sentinel-m1.js —
// a shipped design with hard requirements) and road-vehicle IRs
// compiled live from brief text by the architecture compiler
// (lib/conkay/compiler/architectures.js). Registry: the real 100+
// solvers registered by importing lib/conkay/index.js.
//
// Baseline, first run 2026-11-03 (main 0513f2ad6): 3 documents,
// 7 requirements, 5 solvers consulted — ZERO resolution errors (every
// named solver and target resolves on the live tree), and exactly
// THREE screening-fitness warnings: the Sentinel demo's hard-bound
// requirements R-height / R-duration / R-stability are judged by
// screening:true solvers (geometry.clearance, electrical.budget,
// stability.static). The warnings are pinned BY NAME below: a new
// screening-bound hard requirement entering the corpus, or one of
// these solvers changing its declaration, must change this list
// consciously — that is what makes the suite a gate and not a report.
// Whether the three demo bindings are acceptable is a triage call for
// the ConKay owners, recorded with the R-3 ship filing.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listSolvers } from "../lib/conkay/physics/registry.js";
import "../lib/conkay/index.js";
import { compileBrief } from "../lib/conkay/compiler/architectures.js";
import { buildSentinelM1IR } from "../lib/conkay/demos/sentinel-m1.js";
import { validateIrAgainstSolvers } from "../lib/cross-model-validator.js";

function liveCorpus() {
  const documents = [{ location: "demos/sentinel-m1 buildSentinelM1IR()", ir: buildSentinelM1IR() }];
  const briefs = [
    "Design a steel road car with a top speed of at least 180 km/h and a mass of at most 1400 kg",
    "Design a coupe with a top speed of at least 200 km/h and a mass of at most 1200 kg",
  ];
  briefs.forEach((text, i) => {
    const out = compileBrief(text, { name: `car${i}` });
    assert.ok(out.ir, `brief car${i} should compile to an IR`);
    documents.push({ location: `architectures.compileBrief(car${i})`, ir: out.ir });
  });
  return documents;
}

describe("cross-model validator — live enrolment (IR documents ↔ solver registry)", () => {
  it("the registry loads and the corpus carries real bindings", () => {
    const solvers = listSolvers();
    assert.ok(solvers.length > 100, `expected the full registry, got ${solvers.length}`);
    const res = validateIrAgainstSolvers({ solvers, documents: liveCorpus() });
    assert.equal(res.checked.documents, 3);
    assert.ok(res.checked.requirements >= 7, `expected >= 7 requirements, got ${res.checked.requirements}`);
    assert.ok(res.checked.solversConsulted >= 5);
    assert.deepEqual(res.unverifiable, []);
  });
  it("every named solver and target in the live corpus resolves (zero errors)", () => {
    const res = validateIrAgainstSolvers({ solvers: listSolvers(), documents: liveCorpus() });
    assert.deepEqual(res.errors, []);
  });
  it("the screening-fitness baseline is exactly the three Sentinel bindings", () => {
    const res = validateIrAgainstSolvers({ solvers: listSolvers(), documents: liveCorpus() });
    const got = res.warnings.map((w) => {
      const solver = /solver "([^"]+)"/.exec(w.detail)?.[1];
      const req = /\((R-[a-z]+)\)/.exec(w.location)?.[1];
      return `${req}:${solver}`;
    }).sort();
    assert.deepEqual(got, [
      "R-duration:electrical.budget",
      "R-height:geometry.clearance",
      "R-stability:stability.static",
    ]);
  });
});
