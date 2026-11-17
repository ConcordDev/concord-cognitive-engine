// server/tests/conkay-honesty-helper.test.js
//
// Acceptance tests for the SC-05 shared honesty helper
// (tests/_conkay-honesty.mjs). The helper is additive test infrastructure
// (CB-0823 route): these tests pin ITS behaviour against fixture solvers —
// one honest, three dishonest in the three ways SC-05 names — plus one
// integration pass through the real registry envelope().
//
//   honest fixture       → every leg passes
//   substituting fixture → echo-integrity leg throws, naming the field
//   assuming fixture     → nothing-assumed leg throws, naming the field
//   wrong-domain fixture → citations leg throws, naming the domain
//
// Fails-before note: before the helper existed this suite failed at import
// (no _conkay-honesty.mjs) — the additive-infrastructure shape, disclosed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertEchoIntegrity,
  assertNothingAssumed,
  assertCitationsDomain,
} from "./_conkay-honesty.mjs";
import { envelope } from "../lib/conkay/physics/registry.js";

const SOLVER = { id: "fixture.solver", version: "1.0.0", domain: "physics", fidelity: 1, method: "fixture" };
const FULL = { thickness: 0.01, yieldPa: 250e6 };

// Echoes its inputs, refuses a missing required field by name.
function honestRun(inputs) {
  for (const f of ["thickness", "yieldPa"]) {
    if (!(f in inputs)) return { notComputed: `missing_input:${f}`, inputs: { ...inputs } };
  }
  return { inputs: { ...inputs }, outputs: { stress: 1e8 }, margins: [{ name: "yield", demand: 1e8, capacity: inputs.yieldPa }] };
}

// Echoes a different thickness than supplied.
function substitutingRun(inputs) {
  return { inputs: { ...inputs, thickness: 0.02 }, outputs: { stress: 1e8 }, margins: [] };
}

// Computes happily with yieldPa missing — silently assumes it.
function assumingRun(inputs) {
  const yieldPa = inputs.yieldPa ?? 250e6;
  return { inputs: { ...inputs }, outputs: { stress: 1e8 }, margins: [{ name: "yield", demand: 1e8, capacity: yieldPa }] };
}

// Discloses the default it used, in assumptions, naming the field.
function disclosingRun(inputs) {
  if (!("yieldPa" in inputs)) {
    return {
      inputs: { ...inputs },
      outputs: { stress: 1e8 },
      margins: [],
      assumptions: ["yieldPa defaulted to 250e6 (declared default)"],
    };
  }
  return honestRun(inputs);
}

// Cites a DTU from another domain.
function wrongDomainRun(inputs) {
  return { ...honestRun(inputs), outputs: { stress: 1e8, source: { dtuId: "dtu:chem:abc123", domain: "chem" } } };
}

describe("SC-05 honesty helper — fixture pins", () => {
  it("honest fixture passes all three legs", async () => {
    const raw = honestRun(FULL);
    assertEchoIntegrity(raw, FULL, "honest");
    await assertNothingAssumed((inputs) => honestRun(inputs), FULL, ["thickness", "yieldPa"], "honest");
    assertCitationsDomain(raw, SOLVER, "honest");
  });

  it("substituting fixture fails the echo leg, naming the field", () => {
    assert.throws(() => assertEchoIntegrity(substitutingRun(FULL), FULL, "substituting"), /thickness/);
  });

  it("assuming fixture fails the nothing-assumed leg, naming the field", async () => {
    await assert.rejects(
      () => assertNothingAssumed((inputs) => assumingRun(inputs), FULL, ["yieldPa"], "assuming"),
      /yieldPa/
    );
  });

  it("a disclosed default is not an assumption: disclosing fixture passes", async () => {
    await assertNothingAssumed((inputs) => disclosingRun(inputs), FULL, ["yieldPa"], "disclosing");
  });

  it("wrong-domain citation fails the citations leg, naming the domain", () => {
    assert.throws(() => assertCitationsDomain(wrongDomainRun(FULL), SOLVER, "wrong-domain"), /chem/);
  });

  it("composes with the real registry envelope()", async () => {
    const raw = honestRun(FULL);
    const env = envelope(SOLVER, "P1", raw, { runtimeMs: 1, revision: 0, supplied: FULL, ignored: [] });
    assert.equal(env.status, "PASS");
    assertEchoIntegrity(env, FULL, "envelope");
    assertCitationsDomain(env, SOLVER, "envelope");
    const bad = envelope(SOLVER, "P1", substitutingRun(FULL), { runtimeMs: 1, revision: 0, supplied: FULL, ignored: [] });
    assert.equal(bad.status, "NOT_COMPUTED");
    assert.match(bad.reason, /input_substituted:thickness/);
  });
});
