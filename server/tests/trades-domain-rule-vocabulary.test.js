// Regression pinning: DOMAIN_RULES.get("trades") (lib/domain-logic.js) was
// authored for a generic project/estimate/work-order/inspection/invoice/
// certification shape while the real frontend page (app/lenses/trades/
// page.tsx, a genuine ServiceTitan/Jobber-parity dispatch board) sends
// Job/Estimate/MaterialsList/Permit/Equipment/Client with a quoted/approved/
// in_progress/inspection/completed/invoiced/paid status vocabulary — two
// independently-authored vocabularies that were never reconciled, so every
// real create/status-update on this lens failed validation. Note there is
// ALSO an EXTENDED_DOMAIN_RULES("trades") entry with a third, still-stale
// vocabulary, but it's dead code for this domain (server.js's merge only
// applies an extended rule when no native DOMAIN_RULES entry exists, and
// this domain already has one) — the native rule below is the one that's
// actually live. See audit/LENS_DESIGN_UPGRADE_PLAN.md #240.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateArtifact } from "../lib/domain-logic.js";

describe("trades domain rule matches the real frontend vocabulary", () => {
  const realTypes = ["Job", "Estimate", "MaterialsList", "Permit", "Equipment", "Client"];

  it("accepts every real type the trades page actually sends", () => {
    for (const type of realTypes) {
      const r = validateArtifact("trades", type, { title: "x" }, { status: "quoted" });
      assert.equal(r.ok, true, `expected ${type} to validate, got errors: ${JSON.stringify(r.errors)}`);
    }
  });

  it("accepts every status the page's real Status union can produce", () => {
    for (const status of ["quoted", "approved", "in_progress", "inspection", "completed", "invoiced", "paid"]) {
      const r = validateArtifact("trades", "Job", { title: "x" }, { status });
      assert.equal(r.ok, true, `expected status ${status} to validate, got errors: ${JSON.stringify(r.errors)}`);
    }
  });

  it("rejects the old fake lowercase vocabulary", () => {
    const r = validateArtifact("trades", "job", {}, {});
    assert.equal(r.ok, false);
  });
});
