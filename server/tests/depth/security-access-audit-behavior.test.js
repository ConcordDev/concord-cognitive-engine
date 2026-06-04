// tests/depth/security-access-audit-behavior.test.js — REAL behavioral test for
// security.accessAudit (lens-audit: the "Access Audit" button hit no macro until this
// STATE-based posture audit landed).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("security.accessAudit", () => {
  it("returns a strong posture for an empty inventory", async () => {
    const r = await lensRun("security", "accessAudit", { params: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.postureScore, 100);
    assert.equal(r.result.rating, "strong");
  });

  it("drops the posture score when an open critical vuln exists", async () => {
    const ctx = await depthCtx("sec-audit");
    await lensRun("security", "vuln-add", { params: { title: "RCE", severity: "critical", cvss: 9.8, status: "open" } }, ctx);
    const r = await lensRun("security", "accessAudit", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.openCritical, 1);
    assert.equal(r.result.postureScore, 80);          // 100 − 20 per open critical
    assert.equal(r.result.rating, "moderate");
    assert.ok(r.result.recommendations.some((x) => /critical/i.test(x)));
  });
});
