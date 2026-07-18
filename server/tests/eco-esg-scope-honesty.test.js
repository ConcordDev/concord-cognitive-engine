// server/tests/eco-esg-scope-honesty.test.js
//
// WAVE4 (eco) — `eco.sustainabilityScore` is a real, correct multi-criteria
// ESG (Environmental/Social/Governance) assessment, but it scores an
// ORGANIZATION, not a person, so it must never present as a personal
// ecology metric. This test pins the honest-scope contract: the macro's
// result now carries `scope: "organization"` + a human-readable
// `scopeLabel`, and the underlying computation is byte-identical to before
// the relabel (hand-verified against the same fixture the pre-existing
// server/tests/depth/eco-behavior.test.js and server/tests/eco-lens-macros.test.js
// suites already pin).
//
// Lightweight harness (no server boot, no DB): mirrors the registration
// style in server/tests/eco-lens-macros.test.js — `sustainabilityScore` is
// pure compute over `artifact.data`, so no STATE/DB is touched at all; there
// is nothing to isolate DB_PATH against here, but if a future edit adds
// STATE, follow eco-lens-macros.test.js's `globalThis._concordSTATE = {}`
// pattern to keep this file DB-free.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerEcoActions from "../domains/eco.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "eco", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

function call(name, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`eco.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain: "eco", type: "domain_action", data: input, meta: {} };
  return fn({ actor: { userId: "esg_scope_test" } }, virtualArtifact, input);
}

before(() => { registerEcoActions(registerLensAction); });

describe("eco.sustainabilityScore — honest organization-ESG scope marker", () => {
  it("stamps scope:'organization' + a human scopeLabel on every result", () => {
    const r = call("sustainabilityScore", {
      indicators: {
        environmental: { emissions: 80, energyEfficiency: 80, wasteReduction: 80, waterUsage: 80, biodiversity: 80 },
        social: { laborPractices: 60, communityImpact: 60, healthSafety: 60, diversity: 60, humanRights: 60 },
        governance: { boardDiversity: 40, transparency: 40, ethics: 40, riskManagement: 40, compliance: 40 },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, "organization");
    assert.equal(typeof r.result.scopeLabel, "string");
    // The label must be honest about NOT being a personal metric — the whole
    // point of this unit is that a user can never mistake this for their
    // own footprint score.
    assert.match(r.result.scopeLabel, /organization/i);
    assert.match(r.result.scopeLabel, /not personal/i);
  });

  it("the underlying ESG math is UNCHANGED by the relabel — hand-verified value", () => {
    // Same fixture as server/tests/eco-lens-macros.test.js's
    // "computes pillar + overall scores for a full ESG profile" case.
    // Hand-verified: weights env=0.4, soc=0.35, gov=0.25 (all pillars fully
    // reported, so all three weights are used).
    //   env pillar  = 0.25*80 + 0.2*80 + 0.2*80 + 0.2*80 + 0.15*80 = 80
    //   soc pillar  = 0.25*60 + 0.2*60 + 0.2*60 + 0.2*60 + 0.15*60 = 60
    //   gov pillar  = 0.2*40 + 0.25*40 + 0.2*40 + 0.2*40 + 0.15*40 = 40
    //   overall = (80*0.4 + 60*0.35 + 40*0.25) / (0.4+0.35+0.25)
    //           = (32 + 21 + 10) / 1.0 = 63
    const r = call("sustainabilityScore", {
      indicators: {
        environmental: { emissions: 80, energyEfficiency: 80, wasteReduction: 80, waterUsage: 80, biodiversity: 80 },
        social: { laborPractices: 60, communityImpact: 60, healthSafety: 60, diversity: 60, humanRights: 60 },
        governance: { boardDiversity: 40, transparency: 40, ethics: 40, riskManagement: 40, compliance: 40 },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pillars.environmental.score, 80);
    assert.equal(r.result.pillars.social.score, 60);
    assert.equal(r.result.pillars.governance.score, 40);
    assert.equal(r.result.overallScore, 63);
    assert.equal(r.result.maturityLevel, "Developing"); // 50 <= 63 < 65
    assert.equal(r.result.overallRating, "good"); // 60 <= 63 < 80
    assert.equal(r.result.dataCompleteness, 100);
    // Still carries the honest scope marker alongside the unchanged math.
    assert.equal(r.result.scope, "organization");
  });

  it("scope marker is present even on a minimal/partial-data submission (honest needs-input path)", () => {
    const r = call("sustainabilityScore", { indicators: { environmental: { emissions: 70 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, "organization");
    assert.equal(r.result.pillars.social.score, null);
    assert.equal(r.result.pillars.social.rating, "insufficient data");
  });

  it("scope marker is present even with zero indicators supplied", () => {
    const r = call("sustainabilityScore", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, "organization");
    assert.equal(r.result.overallScore, null);
    assert.equal(r.result.maturityLevel, "Unrated");
  });
});
