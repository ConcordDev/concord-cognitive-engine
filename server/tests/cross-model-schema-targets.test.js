// Cohesive R-3, boot report-mode wiring — seeded pins for
// validateArtifactSchemaTargets (lib/cross-model-dtu.js): a schema
// whose (domain, action) names no live lens action is caught with
// its target named; the domain.* wildcard resolves on its domain
// existing. The LIVE baseline (the real LENS_ACTIONS registry at
// boot) is reported by the boot block itself on its first gated
// run — the registry is monolith-scoped and cannot be imported
// here, which is the entire reason this check lives at boot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateArtifactSchemaTargets } from "../lib/cross-model-dtu.js";

const ACTIONS = new Set(["music.generate-lyrics", "studio.suggest-chords", "food.generate-meal-plan"]);

describe("validateArtifactSchemaTargets — seeded faults", () => {
  it("schemas naming live actions pass clean", () => {
    const res = validateArtifactSchemaTargets({
      schemas: [
        { domain: "music", action: "generate-lyrics" },
        { domain: "food", action: "generate-meal-plan" },
      ],
      lensActions: ACTIONS,
    });
    assert.deepEqual(res.errors, []);
    assert.equal(res.checked.lensActions, 3);
  });
  it("catches a schema registered for an action that does not exist", () => {
    const res = validateArtifactSchemaTargets({
      schemas: [{ domain: "music", action: "generate-lrics" }],
      lensActions: ACTIONS,
    });
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].kind, "schema_target_unresolved");
    assert.equal(res.errors[0].location, "music.generate-lrics");
  });
  it("a wildcard schema resolves on its domain existing — and only then", () => {
    const ok = validateArtifactSchemaTargets({ schemas: [{ domain: "music", action: "*" }], lensActions: ACTIONS });
    assert.deepEqual(ok.errors, []);
    const bad = validateArtifactSchemaTargets({ schemas: [{ domain: "nonexistent", action: "*" }], lensActions: ACTIONS });
    assert.deepEqual(bad.errors.map((e) => e.kind), ["schema_domain_unresolved"]);
  });
  it("accepts the registry as a Map as well as a Set", () => {
    const res = validateArtifactSchemaTargets({
      schemas: [{ domain: "studio", action: "suggest-chords" }],
      lensActions: new Map([["studio.suggest-chords", () => {}]]),
    });
    assert.deepEqual(res.errors, []);
  });
});
