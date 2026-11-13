// Desk creates for realestate and security were 422 validation_failed
// with the form filled in. The domain rules listed a status vocabulary
// the desks never send (and security was missing the AccessControl type).
// validateArtifact is the function lens.create runs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { DOMAIN_RULES, validateArtifact, getValidTransitions } from "../lib/domain-logic.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

// ArtifactDeskPanel STATUSES_BY_TYPE — the words the New Record form sends.
const REALESTATE_FORM = [
  "coming_soon", "active", "pending", "contingent", "sold", "withdrawn", "expired",
  "listing_prep", "offer", "under_contract", "inspection", "appraisal", "clear_to_close", "closed", "fell_through",
  "draft", "in_progress", "completed", "presented",
  "vacant", "listed", "application", "leased", "month_to_month", "notice_given", "eviction",
  "prospecting", "analysis", "due_diligence", "passed",
  "scheduled", "confirmed", "cancelled", "no_show",
];

// SecurityOpsPanel getStatusesForTab — the words Cases sends.
const SECURITY_FORM = [
  "detected", "triaged", "contained", "eradicated", "recovered", "closed",
  "active", "inactive", "maintenance",
  "completed", "scheduled", "cancelled",
  "online", "offline",
  "expired", "suspended", "revoked",
  "monitoring", "mitigated", "resolved",
];

const SECURITY_TYPES = ["Incident", "Asset", "Patrol", "Surveillance", "AccessControl", "ThreatIntel"];

describe("realestate desk status vocabulary", () => {
  it("accepts every form status on an artifact create", () => {
    for (const status of REALESTATE_FORM) {
      const r = validateArtifact("realestate", "artifact", { title: "QA listing", artifactType: "Listing" }, { status });
      assert.equal(r.ok, true, `${status}: ${JSON.stringify(r.errors)}`);
    }
  });

  it("still accepts a legacy status and names the vocabulary when it rejects", () => {
    const ok = validateArtifact("realestate", "listing", { title: "x" }, { status: "under-contract" });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const bad = validateArtifact("realestate", "artifact", { title: "x" }, { status: "not-a-status" });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /Invalid status "not-a-status"/.test(e) && e.includes("prospecting")));
  });

  it("lets a new status move to any other form status", () => {
    const next = getValidTransitions("realestate", "prospecting");
    assert.ok(next.includes("closed"));
    assert.ok(next.includes("active"));
    assert.ok(!next.includes("prospecting"));
  });
});

describe("security cases status vocabulary", () => {
  it("accepts every form status for every cases type, including Access", () => {
    for (const type of SECURITY_TYPES) {
      for (const status of SECURITY_FORM) {
        const r = validateArtifact("security", type, { title: "QA case" }, { status });
        assert.equal(r.ok, true, `${type}/${status}: ${JSON.stringify(r.errors)}`);
      }
    }
  });

  it("accepts the walked defaults: Incident/detected, Asset/active, AccessControl/active", () => {
    assert.equal(validateArtifact("security", "Incident", { title: "phish" }, { status: "detected" }).ok, true);
    assert.equal(validateArtifact("security", "Asset", { title: "host" }, { status: "active" }).ok, true);
    assert.equal(validateArtifact("security", "AccessControl", { title: "badge" }, { status: "active" }).ok, true);
  });

  it("rejects an unknown status and still names the valid list", () => {
    const r = validateArtifact("security", "Incident", { title: "x" }, { status: "bogus" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid status "bogus"/.test(e) && e.includes("detected")));
  });
});
