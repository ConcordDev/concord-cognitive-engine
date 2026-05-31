// Wave 5 #20 — institution design. Pins the contingency logic: size picks the
// decision rule, threat centralises + thins checks (to a floor), cohesion gates
// consensus, and large bodies get a bounded representative council.
//
// Run: node --test tests/viability/institution-design.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { designInstitution, DECISION_RULES } from "../../lib/viability/institution-design.js";

describe("designInstitution", () => {
  it("small + cohesive → consensus with a high quorum", () => {
    const d = designInstitution({ memberCount: 6, cohesion: 0.8, externalThreat: 0.1 });
    assert.equal(d.decisionRule, "consensus");
    assert.ok(d.quorum >= 5);
    assert.equal(d.council, null);
  });

  it("a large body → a bounded representative council", () => {
    const d = designInstitution({ memberCount: 400, cohesion: 0.5, externalThreat: 0.2 });
    assert.equal(d.decisionRule, "council");
    assert.ok(d.council.seats >= 5 && d.council.seats <= 50);
  });

  it("high external threat centralises and thins checks (but never to zero)", () => {
    const calm = designInstitution({ memberCount: 10, cohesion: 0.5, externalThreat: 0.1 });
    const siege = designInstitution({ memberCount: 10, cohesion: 0.5, externalThreat: 0.95 });
    assert.ok(siege.centralization > calm.centralization);
    assert.ok(siege.checks.length < calm.checks.length);
    assert.ok(siege.checks.length >= 1, "checks never vanish");
    assert.equal(siege.decisionRule, "autocracy"); // tiny + besieged → war council
  });

  it("centralization shortens term limits (anti-entrenchment)", () => {
    const flat = designInstitution({ memberCount: 10, cohesion: 0.9, externalThreat: 0.0 });
    const central = designInstitution({ memberCount: 10, cohesion: 0.1, externalThreat: 0.9 });
    assert.ok(central.termLimitDays < flat.termLimitDays);
  });

  it("always returns a known decision rule", () => {
    for (const n of [1, 8, 30, 100, 1000]) {
      assert.ok(DECISION_RULES.includes(designInstitution({ memberCount: n }).decisionRule));
    }
  });
});
