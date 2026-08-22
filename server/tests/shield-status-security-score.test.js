// Regression pinning: audit/LENS_DESIGN_UPGRADE_PLAN.md #213 (sentinel) found
// the "SECURITY SCORE" stat tile rendering the literal string "[object Object]"
// instead of a number. Root cause: `shield.status` (server.js) sent
// `securityScore: computeSecurityScore(...)`'s full return value directly —
// computeSecurityScore returns `{ score, grade, breakdown }`, not a bare
// number — so the frontend's String(securityScore) rendered the object.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

test("shield.status sends a numeric securityScore, not the whole score object", async () => {
  const { runMacro } = await load();
  const r = await runMacro("shield", "status", { userId: "shield-status-test-user" }, { actor: { userId: "shield-status-test-user", role: "member" } });
  assert.equal(r.ok, true);
  assert.equal(typeof r.securityScore, "number", "securityScore must be a number, not the {score,grade,breakdown} object");
  assert.equal(typeof r.securityGrade, "string");
  assert.equal(typeof r.securityScoreBreakdown, "object");
});
