// Regression test for sim.md's F3 finding (canonical lens review): the sim
// domain's DOMAIN_RULES entry had two real, verified gaps around a "run"
// artifact's lifecycle, surfaced only once SimConsole.tsx's own bug (reading
// an artifact id off the wrong envelope level) was fixed and real "run"
// artifacts could actually reach the completed/failed states:
//
//  1. `status: "failed"` (the status SimConsole.tsx's handleRunSimulation
//     catch block persists when the client-side Monte Carlo run throws) was
//     neither a valid status nor a valid transition from "running" — a
//     genuine run failure could not be recorded at all (it would itself
//     return `invalid_transition`, compounding the original error).
//  2. computedFields set `data.hasResults = !!data.lastRun` — `lastRun` is a
//     field no caller (frontend or backend) ever writes; a completed run's
//     real field is `data.results` (see concord-frontend's SimRun type), so
//     `hasResults` was permanently false for every real run.
//
// Pinned bidirectionally: the "failed" transition now succeeds (and did not
// before), and `hasResults` reflects a real `results` payload (and did not
// before, verified against the pre-fix field name too).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { computeFields, validateArtifact, getValidTransitions, DOMAIN_RULES } from "../lib/domain-logic.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

describe("domain-logic — sim run-artifact lifecycle (F3 fix)", () => {
  // server.js merges the frontend's real artifact-type vocabulary into
  // DOMAIN_RULES at boot (reconcileArtifactTypes — "sim": ["run"]). Mirror
  // that here so validateArtifact sees the same rule shape it does live;
  // skipping this step would fail every "run"-type check below on an
  // already-fixed, unrelated defect this test isn't about.
  before(() => { reconcileArtifactTypes(DOMAIN_RULES); });

  it("'failed' is a valid status for the sim domain", () => {
    const v = validateArtifact("sim", "run", { status: "failed" }, { status: "failed" });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  });

  it("running -> failed is a valid transition (a run that throws can be recorded as failed)", () => {
    const next = getValidTransitions("sim", "running");
    assert.ok(next.includes("failed"), `expected "failed" in valid transitions from "running", got: ${next.join(", ")}`);
    assert.ok(next.includes("completed"), "running -> completed must still be valid");
  });

  it("failed -> configured/archived remain reachable (a failed run can be reconfigured or archived)", () => {
    const next = getValidTransitions("sim", "failed");
    assert.ok(next.includes("configured"));
    assert.ok(next.includes("archived"));
  });

  it("hasResults is true once a run carries real `results` data (the actual frontend field)", () => {
    const out = computeFields("sim", "run", { results: { mean: 42, outcomes: [] } });
    assert.equal(out.hasResults, true);
  });

  it("hasResults stays false for a run with no results yet (still running / never completed)", () => {
    const out = computeFields("sim", "run", { status: "running", progress: 50 });
    assert.equal(out.hasResults, false);
  });

  it("regression guard: the old `lastRun`-only field name alone (no `results`) is not sufficient on its own to prove the shape changed — but IS still honored for back-compat", () => {
    // Back-compat: anything that genuinely sets `lastRun` still counts.
    const out = computeFields("sim", "run", { lastRun: { at: "2026-01-01" } });
    assert.equal(out.hasResults, true);
    // The real defect: `results`-only (the actual frontend shape) used to be
    // silently ignored. It no longer is (pinned by the test above).
  });

  it("the sim domain rule itself declares the fixed vocabulary (direct check, no reliance on helpers)", () => {
    const rule = DOMAIN_RULES.get("sim");
    assert.ok(rule.validStatuses.includes("failed"), "validStatuses must include 'failed'");
    assert.ok(rule.transitions.running.includes("failed"), "transitions.running must include 'failed'");
  });
});
