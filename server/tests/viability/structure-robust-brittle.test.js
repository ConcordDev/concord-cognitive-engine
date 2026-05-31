// Wave 2 — corpus #4 (robust-vs-brittle), on the spine + the N7 materials core.
// Pins: structural viability from health, robustness ranking, and the headline —
// the SAME shock that shatters a brittle material leaves a ductile one fine, and
// ductile materials degrade gracefully where brittle ones snap.
//
// Run: node --test tests/viability/structure-robust-brittle.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { structuralViability, robustness, absorbHit } from "../../lib/viability/adapters/structure.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("structural viability + robustness", () => {
  it("viability tracks health_pct", () => {
    assert.ok(close(structuralViability(1), 1));
    assert.equal(structuralViability(0), 0);
    assert.ok(close(structuralViability(0.5), 0.5));
  });
  it("ductile steel is far more robust than brittle glass/stone", () => {
    assert.ok(robustness("steel") > robustness("glass"));
    assert.ok(robustness("steel") > robustness("stone"));
  });
});

describe("robust degrades, brittle shatters (#4)", () => {
  it("a shock that shatters glass leaves steel untouched", () => {
    // stress 60: glass (ultimate 50) fractures+shatters; steel (yield 120) is elastic
    const glass = absorbHit("glass", 1.0, 60);
    const steel = absorbHit("steel", 1.0, 60);
    assert.equal(glass.shattered, true);
    assert.equal(glass.newHealthPct, 0);       // gone
    assert.equal(steel.state, "elastic");
    assert.equal(steel.newHealthPct, 1.0);     // unscathed
  });

  it("at fracture stress, steel takes heavy-but-survivable damage; glass is destroyed", () => {
    const steel = absorbHit("steel", 1.0, 250);  // > ultimate 200 → fracture, ductile
    assert.equal(steel.fractured, true);
    assert.equal(steel.shattered, false);
    assert.ok(steel.newHealthPct > 0 && steel.newHealthPct < 1); // damaged, not destroyed
    const glass = absorbHit("glass", 1.0, 60);
    assert.equal(glass.shattered, true);
  });

  it("yielding causes gradual damage softened by robustness", () => {
    const steel = absorbHit("steel", 1.0, 150); // yield..ultimate → yielding
    assert.equal(steel.state, "yielding");
    assert.ok(steel.newHealthPct < 1 && steel.newHealthPct > 0.9); // small, graceful
    assert.ok(steel.viability < 1);
  });
});
