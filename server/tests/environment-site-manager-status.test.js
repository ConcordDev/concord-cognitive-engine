// Environment F2 — the Site Manager's form statuses must match the domain
// rule's vocabulary (Review 2 first pass 2026-10-31).
//
// FieldOpsPanel's Status union is active | monitoring | critical |
// remediation | closed | seasonal, and every create sends meta.status
// (default "active"). The environment rule in domain-logic-extended.js
// carried draft/collecting/analyzed/published/archived — a vocabulary
// sharing NO status with the page — so validateArtifact rejected 100% of
// Site Manager creates with validation_failed, however completely the
// form was filled (five escalating attempts in the walk, all identical).
// Same stale-vocabulary genus as government F2 (see
// government-case-file-status.test.js) and the services/security fix
// domain-logic.js documents (audit #240).
//
// This suite pins the alignment at the exact function the lens create
// handler runs: every form-selectable status validates for every type
// the desk creates; the gate still rejects an out-of-vocabulary status
// with an error that NAMES the valid statuses; "capture" (a Quick
// Capture is an in-domain DTU creation) validates as a type.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { DOMAIN_RULES, validateArtifact, getValidTransitions } from "../lib/domain-logic.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

// Merge extended rules the same way server.js does at boot.
for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

const FORM_STATUSES = [
  "active",
  "monitoring",
  "critical",
  "remediation",
  "closed",
  "seasonal",
];

// The types FieldOpsPanel creates through useLensData('environment', type).
const DESK_TYPES = [
  "Site",
  "Species",
  "EnvironmentalSample",
  "TrailAsset",
  "WasteStream",
  "ComplianceRecord",
  "CarbonEntry",
  "ResourceMetric",
  "SustainabilityGoal",
];

describe("environment Site Manager status vocabulary (F2)", () => {
  it("rejects the old rule vocabulary's 'draft' that no form sends", () => {
    const r = validateArtifact("environment", "Site", { title: "x" }, { status: "draft" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid status "draft"/.test(e)));
    // The rejection names the valid vocabulary — the failing "field" is
    // never a bare validation_failed to the reader of the error.
    assert.ok(r.errors.some((e) => e.includes("active") && e.includes("seasonal")));
  });

  it("accepts every form-selectable status for every desk type", () => {
    for (const type of DESK_TYPES) {
      for (const status of FORM_STATUSES) {
        const r = validateArtifact("environment", type, { title: "x" }, { status });
        assert.equal(
          r.ok,
          true,
          `${type}/${status} should validate, got: ${JSON.stringify(r.errors)}`,
        );
      }
    }
  });

  it("accepts the walked case: a Site create at the form default 'active'", () => {
    const r = validateArtifact(
      "environment",
      "Site",
      { name: "PR2ENV site", watershed: "Hudson", ecoregion: "Eastern Temperate Forests" },
      { status: "active" },
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it("accepts a create with no status (API callers) and rejects an unknown type", () => {
    assert.equal(validateArtifact("environment", "Site", {}, {}).ok, true);
    assert.equal(validateArtifact("environment", "NotAType", {}, { status: "active" }).ok, false);
  });

  it("admits 'capture' as a type — a Quick Capture is an in-domain creation", () => {
    const r = validateArtifact("environment", "capture", { title: "PR2ENV capture" }, { status: "active" });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it("transitions form a complete graph among the six form statuses", () => {
    for (const from of FORM_STATUSES) {
      const targets = getValidTransitions("environment", from);
      for (const to of FORM_STATUSES) {
        if (to === from) continue;
        assert.ok(targets.includes(to), `${from} -> ${to} should be a valid transition`);
      }
    }
  });
});
