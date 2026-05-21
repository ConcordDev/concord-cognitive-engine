// Tier-2 contract tests for audit lens parity macros — compliance-automation core
// vs Vanta / Drata: control framework mapping, evidence collection, continuous
// monitoring, findings tracker, policy library, exportable report, vendor register.
// Also pins the pure-compute analytics macros (complianceCheck / trailAnalysis /
// riskScore / samplingPlan).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAuditActions from "../domains/audit.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`audit.${name}`);
  if (!fn) throw new Error(`audit.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
// For artifact-store analytics macros that read artifact.data.
function callArtifact(name, ctx, data = {}, params = {}) {
  const fn = ACTIONS.get(`audit.${name}`);
  if (!fn) throw new Error(`audit.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  registerAuditActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("audit — pure-compute analytics", () => {
  it("complianceCheck flags violations and computes rate", () => {
    const r = callArtifact("complianceCheck", ctxA, {
      records: [
        { id: "r1", fields: { email: "x@y.com", age: 30 } },
        { id: "r2", fields: { email: "", age: 200 } },
      ],
      rules: [
        { id: "u1", name: "Email required", field: "email", type: "required" },
        { id: "u2", name: "Age range", field: "age", type: "range", min: 0, max: 120 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRecords, 2);
    assert.ok(r.result.totalViolations >= 2);
    assert.ok(typeof r.result.overallComplianceRate === "number");
  });

  it("trailAnalysis detects sequence gaps", () => {
    const r = callArtifact("trailAnalysis", ctxA, {
      trail: [
        { sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z", actor: "a", action: "x", objectId: "o" },
        { sequenceNumber: 3, timestamp: "2026-01-01T01:00:00Z", actor: "a", action: "y", objectId: "o" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEntries, 2);
    assert.ok(r.result.issues.some((i) => i.type === "sequence-gap"));
  });

  it("riskScore returns a bounded audit risk", () => {
    const r = callArtifact("riskScore", ctxA, {
      controls: [{ id: "c1", name: "MFA", effectiveness: 0.9 }],
      inherentRisks: [{ id: "i1", name: "Phishing", likelihood: 0.5, impact: 0.6 }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.auditRisk >= 0 && r.result.auditRisk <= 1);
    assert.ok(["high", "medium", "low"].includes(r.result.riskLevel));
  });

  it("samplingPlan computes a finite sample size", () => {
    const r = callArtifact("samplingPlan", ctxA, { population: { total: 10000 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.requiredSampleSize > 0);
    assert.ok(r.result.requiredSampleSize <= 10000);
  });
});

describe("audit — control framework mapping", () => {
  it("frameworkCatalog lists SOC 2 and ISO 27001", () => {
    const r = call("frameworkCatalog", ctxA);
    assert.equal(r.ok, true);
    const ids = r.result.frameworks.map((f) => f.id);
    assert.ok(ids.includes("soc2"));
    assert.ok(ids.includes("iso27001"));
  });

  it("frameworkAdopt seeds controls and is idempotent", () => {
    const r1 = call("frameworkAdopt", ctxA, { framework: "soc2" });
    assert.equal(r1.ok, true);
    assert.ok(r1.result.added > 0);
    const r2 = call("frameworkAdopt", ctxA, { framework: "soc2" });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.added, 0);
  });

  it("frameworkAdopt rejects unknown framework", () => {
    const r = call("frameworkAdopt", ctxA, { framework: "nonsense" });
    assert.equal(r.ok, false);
  });

  it("controlList summarizes status + per-user scoping", () => {
    call("frameworkAdopt", ctxA, { framework: "iso27001" });
    const r = call("controlList", ctxA, { framework: "iso27001" });
    assert.equal(r.ok, true);
    assert.ok(r.result.controls.length > 0);
    assert.equal(r.result.summary.total, r.result.controls.length);
    // user_b has no controls
    const rb = call("controlList", ctxB);
    assert.equal(rb.result.controls.length, 0);
  });

  it("controlUpdate sets status and rejects invalid status", () => {
    call("frameworkAdopt", ctxA, { framework: "soc2" });
    const id = call("controlList", ctxA).result.controls[0].id;
    const ok = call("controlUpdate", ctxA, { id, status: "pass", owner: "Jane" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.control.status, "pass");
    const bad = call("controlUpdate", ctxA, { id, status: "weird" });
    assert.equal(bad.ok, false);
  });
});

describe("audit — evidence collection", () => {
  it("evidenceAdd attaches to a control, lists, and deletes", () => {
    call("frameworkAdopt", ctxA, { framework: "soc2" });
    const controlId = call("controlList", ctxA).result.controls[0].id;
    const add = call("evidenceAdd", ctxA, { controlId, title: "MFA screenshot", kind: "screenshot" });
    assert.equal(add.ok, true);
    const list = call("evidenceList", ctxA, { controlId });
    assert.equal(list.result.total, 1);
    const del = call("evidenceDelete", ctxA, { id: add.result.evidence.id });
    assert.equal(del.ok, true);
    assert.equal(call("evidenceList", ctxA, { controlId }).result.total, 0);
  });

  it("evidenceAdd rejects missing control", () => {
    const r = call("evidenceAdd", ctxA, { controlId: "missing", title: "x" });
    assert.equal(r.ok, false);
  });
});

describe("audit — continuous monitoring", () => {
  it("monitorList exposes automated checks", () => {
    const r = call("monitorList", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.checks.some((c) => c.id === "mfa_enforced"));
  });

  it("monitorConfigure + monitorRun evaluates facts and auto-updates controls", () => {
    call("frameworkAdopt", ctxA, { framework: "soc2" });
    call("monitorConfigure", ctxA, {
      checkId: "mfa_enforced",
      enabled: true,
      facts: { mfaUsers: 10, totalUsers: 10 },
    });
    const run = call("monitorRun", ctxA);
    assert.equal(run.ok, true);
    assert.equal(run.result.totalChecks, 1);
    assert.equal(run.result.passed, 1);
    assert.ok(run.result.autoUpdatedControls > 0);
  });

  it("monitorConfigure rejects unknown check", () => {
    const r = call("monitorConfigure", ctxA, { checkId: "fake", enabled: true });
    assert.equal(r.ok, false);
  });
});

describe("audit — findings tracker", () => {
  it("findingAdd / findingUpdate / findingList with severity sort + overdue", () => {
    const add = call("findingAdd", ctxA, {
      title: "Stale access keys",
      severity: "high",
      owner: "Sam",
      dueDate: "2020-01-01",
    });
    assert.equal(add.ok, true);
    const list = call("findingList", ctxA);
    assert.equal(list.result.summary.total, 1);
    assert.equal(list.result.findings[0].overdue, true);
    const upd = call("findingUpdate", ctxA, { id: add.result.finding.id, status: "closed" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.finding.status, "closed");
  });

  it("findingAdd requires a title", () => {
    assert.equal(call("findingAdd", ctxA, {}).ok, false);
  });
});

describe("audit — policy library", () => {
  it("policyAdd / policyAccept / lists track acceptance", () => {
    const add = call("policyAdd", ctxA, { title: "Acceptable Use Policy", version: "2.0" });
    assert.equal(add.ok, true);
    const policyId = add.result.policy.id;
    const acc = call("policyAccept", ctxA, { policyId, acceptedBy: "emp1" });
    assert.equal(acc.ok, true);
    // Duplicate acceptance is idempotent
    const dup = call("policyAccept", ctxA, { policyId, acceptedBy: "emp1" });
    assert.equal(dup.result.duplicate, true);
    const list = call("policyList", ctxA);
    assert.equal(list.result.policies[0].acceptanceCount, 1);
    const accList = call("policyAcceptanceList", ctxA, { policyId });
    assert.equal(accList.result.total, 1);
  });

  it("policyAccept rejects missing policy", () => {
    assert.equal(call("policyAccept", ctxA, { policyId: "x", acceptedBy: "e" }).ok, false);
  });
});

describe("audit — exportable report", () => {
  it("exportReport aggregates state into report + markdown", () => {
    call("frameworkAdopt", ctxA, { framework: "soc2" });
    call("findingAdd", ctxA, { title: "Critical gap", severity: "critical" });
    const r = call("exportReport", ctxA, { organization: "Acme" });
    assert.equal(r.ok, true);
    assert.equal(r.result.report.organization, "Acme");
    assert.ok(r.result.report.summary.totalControls > 0);
    assert.equal(r.result.report.summary.criticalFindings, 1);
    assert.match(r.result.markdown, /Compliance Audit Report/);
  });
});

describe("audit — vendor risk register", () => {
  it("vendorAdd derives a risk tier and lists with summary", () => {
    const add = call("vendorAdd", ctxA, {
      name: "CloudCo",
      dataAccess: "critical",
      criticality: "high",
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.vendor.riskTier, "high");
    const list = call("vendorList", ctxA);
    assert.equal(list.result.summary.total, 1);
    assert.equal(list.result.summary.byTier.high, 1);
  });

  it("vendorUpdate recomputes risk and validates status", () => {
    const id = call("vendorAdd", ctxA, { name: "LowCo", dataAccess: "none", criticality: "low" })
      .result.vendor.id;
    const upd = call("vendorUpdate", ctxA, { id, dataAccess: "critical", criticality: "high" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.vendor.riskTier, "high");
    assert.equal(call("vendorUpdate", ctxA, { id, status: "bogus" }).ok, false);
  });

  it("vendorAdd requires a name", () => {
    assert.equal(call("vendorAdd", ctxA, {}).ok, false);
  });
});
