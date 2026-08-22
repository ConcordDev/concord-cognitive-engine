// Regression pinning: EXTENDED_DOMAIN_RULES.get("services") was authored for
// a generic support-ticket shape (ticket/sla/catalog/request/feedback) while
// the real frontend page (app/lenses/services/page.tsx, a genuine
// Vagaro-style appointment-booking business) sends Appointment/Client/
// ServiceItem/StaffMember/Transaction/Product — two independently-authored
// vocabularies that were never reconciled, so every real create on this
// lens failed validation. See audit/LENS_DESIGN_UPGRADE_PLAN.md #214.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";

for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}

describe("services domain rule matches the real frontend vocabulary", () => {
  const realTypes = ["Appointment", "Client", "ServiceItem", "StaffMember", "Transaction", "Product"];

  it("accepts every real type the services page actually sends", () => {
    for (const type of realTypes) {
      const r = validateArtifact("services", type, { title: "x" }, { status: "booked" });
      assert.equal(r.ok, true, `expected ${type} to validate, got errors: ${JSON.stringify(r.errors)}`);
    }
  });

  it("accepts every status the page's getStatusesForTab() can produce", () => {
    for (const status of ["booked", "confirmed", "in_progress", "completed", "no_show", "cancelled", "active", "inactive"]) {
      const r = validateArtifact("services", "Appointment", { title: "x" }, { status });
      assert.equal(r.ok, true, `expected status ${status} to validate, got errors: ${JSON.stringify(r.errors)}`);
    }
  });

  it("rejects the old fake ticket-shaped vocabulary", () => {
    const r = validateArtifact("services", "ticket", {}, {});
    assert.equal(r.ok, false);
  });
});
