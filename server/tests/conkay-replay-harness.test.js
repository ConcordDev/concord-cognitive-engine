// server/tests/conkay-replay-harness.test.js
//
// SXC-23 — the walker replay harness pin. Runs the harness over
// every doc in docs/conkay/solvers/ and asserts:
//   1. every doc's replay EXECUTES and every parsed expectation
//      holds (declared status, supplied-value preservation,
//      simple output equalities) — the harness's own report;
//   2. the UNREDUCED fragment set (expectations the grammar
//      cannot reduce — contains / sums / set literals) equals
//      exactly the known set below: new unreduced prose fails
//      CI until a human classifies it (SXC-25's discipline);
//   3. the NOT-ECHOED set (supplied top-level inputs a solver
//      declares it does not echo) equals exactly the known set.
// The walker runs the same module post-fix via
// scripts/conkay-replay.mjs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "../lib/conkay/replay/harness.js";
import "../lib/conkay/index.js";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "conkay", "solvers");
const rows = runAll(DOCS);
const byId = new Map(rows.map((r) => [r.solver, r]));

const KNOWN_UNREDUCED = {
  "cad.bom-structure": ["outputs.totalMassKg"],
  "cad.drawings-detail": ["outputs.discrepancies"],
  "cad.part-geometry": ["outputs.massCoverage == {withMass: 1, withoutMass: 1}"],
  "orc.chain-run": ["outputs.chainReceipt.skipped"],
  "orc.edit-commands": ["outputs.editedNodes", "outputs.ops", "outputs.untouchedNodes"],
  "orc.integration-checks": ["outputs.notRun"],
  "orc.intent-parse": ["inputs.text"],
  "orc.iterate": ["outputs.finalFailures"],
  "orc.mass-bom": ["outputs.masslessParts"],
  "orc.requirements": ["outputs.flagged", "outputs.requirements"],
  "orc.solver-map": ["outputs.gaps"],
  "orc.system-architecture": ["outputs.rootRequirement.source"],
  "orc.system-report": ["outputs.unreceipted"],
};
const KNOWN_NOT_ECHOED = { "orc.edit-commands": ["design"] };

describe("SXC-23 — walker replay harness", () => {
  it("covers every solver doc on this branch (non-vacuity: the B3 wave-0 set)", () => {
    assert.ok(rows.length >= 19, `expected at least 19 solver docs, saw ${rows.length}`);
    for (const id of ["orc.intent-parse", "orc.requirements", "orc.system-architecture", "orc.feasibility", "orc.solver-map", "orc.mass-bom", "orc.edit-commands", "orc.integration-checks", "orc.research-gaps", "orc.system-report", "orc.iterate", "orc.chain-run", "cad.mass-properties-brep", "mesh.generate", "cad.parametric-features", "cad.part-geometry", "cad.assembly-constraints", "cad.drawings-detail", "cad.bom-structure"]) {
      assert.ok(byId.has(id), `missing replay doc for ${id}`);
    }
    const forms = rows.map((r) => r.form);
    assert.ok(forms.includes("ir") && forms.includes("solver_id") && forms.includes("fixture"), `all three replay forms exercised: ${forms.join(",")}`);
  });

  it("every replay executes and every parsed expectation holds", () => {
    const failures = rows.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.solver}: ${c.kind}: ${c.detail}`));
    assert.deepEqual(failures, []);
    assert.ok(rows.every((r) => r.status === "PASS"));
  });

  it("the unreduced set is exactly the known set (shrink or re-classify deliberately)", () => {
    const actual = {};
    for (const r of rows) if (r.unreduced.length) actual[r.solver] = [...r.unreduced].sort();
    const expected = Object.fromEntries(Object.entries(KNOWN_UNREDUCED).map(([k, v]) => [k, [...v].sort()]));
    assert.deepEqual(actual, expected);
  });

  it("the not-echoed set is exactly the known set", () => {
    const actual = {};
    for (const r of rows) if ((r.notEchoed ?? []).length) actual[r.solver] = [...r.notEchoed].sort();
    assert.deepEqual(actual, KNOWN_NOT_ECHOED);
  });
});
