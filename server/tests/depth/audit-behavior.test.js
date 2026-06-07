// tests/depth/audit-behavior.test.js — REAL behavioral tests (audit/GRC lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("audit — risk math", () => {
  it("riskScore: returns a leveled risk with components", async () => {
    const r = await lensRun("audit", "riskScore", { data: { controls: [{ effectiveness: 0.8 }], inherentRisks: [{ score: 9 }] }, params: { priorRiskLevel: "high" } });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.riskLevel === "string");
    assert.ok(r.result.components && typeof r.result.components.controlRisk === "number");
  });
});

describe("audit — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-crud"); });
  it("evidenceAdd: rejects evidence for a control that doesn't exist (referential integrity)", async () => {
    // real validation behavior — evidence must attach to an adopted control,
    // so a bogus controlId is refused rather than silently orphaned.
    const added = await lensRun("audit", "evidenceAdd", { params: { controlId: "NOPE-999", title: "orphan" } }, ctx);
    // lens.run dispatches ok; the handler's refusal is nested in result.
    assert.equal(added.result.ok, false);
    assert.match(String(added.result.error), /control not found/i);
  });
  it("evidenceList: returns the evidence ledger shape (empty until controls exist)", async () => {
    const list = await lensRun("audit", "evidenceList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.equal(typeof list.result.total, "number");
    assert.ok(Array.isArray(list.result.evidence));
  });
  it("controlList: returns controls + a compliance-rate summary", async () => {
    const r = await lensRun("audit", "controlList", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.controls));
    assert.equal(typeof r.result.summary.complianceRate, "number");
    assert.equal(r.result.summary.total, r.result.controls.length);
  });
});

describe("audit — calc macros (wave 12 top-up)", () => {
  it("complianceCheck: a required-field violation is counted with exact rate", async () => {
    const r = await lensRun("audit", "complianceCheck", { data: {
      records: [
        { id: "r1", fields: { name: "Alice", ssn: "123-45-6789" } },
        { id: "r2", fields: { name: "" /* missing */, ssn: "999-99-9999" } },
      ],
      rules: [
        { id: "rq", name: "Name required", field: "name", type: "required" },
        { id: "pt", name: "SSN format", field: "ssn", type: "pattern", pattern: "^\\d{3}-\\d{2}-\\d{4}$" },
      ],
    } });
    assert.equal(r.ok, true);
    // r2 fails the required rule → exactly one violation overall.
    assert.equal(r.result.totalViolations, 1);
    assert.equal(r.result.totalRecords, 2);
    // r1 fully compliant (2/2 rules) → 100%.
    const r1 = r.result.recordResults.find(x => x.recordId === "r1");
    assert.equal(r1.complianceRate, 100);
    // The violation names the failing rule.
    assert.ok(r.result.recordResults.find(x => x.recordId === "r2").violations.some(v => v.ruleId === "rq"));
  });

  it("complianceCheck: range rule flags an out-of-bounds value and detects field gaps", async () => {
    const r = await lensRun("audit", "complianceCheck", { data: {
      records: [{ id: "a", fields: { age: "150" } }],
      rules: [
        { id: "rng", name: "Age range", field: "age", type: "range", min: 0, max: 120 },
        { id: "miss", name: "Email present", field: "email", type: "required" },
      ],
    } });
    assert.equal(r.ok, true);
    // age=150 exceeds max → 1 violation for the range; email never present → 1 more.
    assert.ok(r.result.recordResults[0].violations.some(v => v.ruleId === "rng"));
    // 'email' is referenced by a rule but never present in any record → field gap.
    assert.deepEqual(r.result.fieldGaps, ["email"]);
  });

  it("trailAnalysis: detects a sequence gap and scores integrity below 100", async () => {
    const r = await lensRun("audit", "trailAnalysis", { data: {
      trail: [
        { sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z", actor: "sys", action: "create", objectId: "o1" },
        { sequenceNumber: 3, timestamp: "2026-01-01T00:01:00Z", actor: "sys", action: "update", objectId: "o1" },
      ],
    } });
    assert.equal(r.ok, true);
    // Gap between seq 1 and 3 → one high-severity sequence-gap issue.
    assert.ok(r.result.issues.some(i => i.type === "sequence-gap" && i.missingCount === 1));
    // 1 high issue → 100 - 10 = 90.
    assert.equal(r.result.integrityScore, 90);
    assert.deepEqual(r.result.sequenceRange, { first: 1, last: 3 });
  });

  it("trailAnalysis: flags an unauthorized actor as critical when expectedActors given", async () => {
    const r = await lensRun("audit", "trailAnalysis", { data: {
      trail: [
        { sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z", actor: "alice", action: "read", objectId: "o" },
        { sequenceNumber: 2, timestamp: "2026-01-01T00:00:01Z", actor: "mallory", action: "delete", objectId: "o" },
      ],
    }, params: { expectedActors: ["alice"] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.issues.some(i => i.type === "unauthorized-actor" && i.actor === "mallory" && i.severity === "critical"));
    // 1 critical → 100 - 20 = 80.
    assert.equal(r.result.integrityScore, 80);
  });

  it("samplingPlan: computes a finite sample size and exact z-score for 95% confidence", async () => {
    const r = await lensRun("audit", "samplingPlan", { data: {
      population: { total: 1000 },
    }, params: { confidenceLevel: 0.95, marginOfError: 0.05, expectedDefectRate: 0.05 } });
    assert.equal(r.ok, true);
    // z for 95% is the table value.
    assert.equal(r.result.parameters.zScore, 1.96);
    // n_inf = 1.96^2 * .05 * .95 / .05^2 = 72.99 → ceil 73.
    assert.equal(r.result.infinitePopulationSampleSize, 73);
    // finite correction for N=1000: ceil(72.99/(1+71.99/1000)) = ceil(68.09) = 69.
    assert.equal(r.result.requiredSampleSize, 69);
    // Sample can't exceed population.
    assert.ok(r.result.requiredSampleSize <= r.result.populationSize);
  });

  it("samplingPlan: risk-weighted stratified allocation favors high-risk strata", async () => {
    const r = await lensRun("audit", "samplingPlan", { data: {
      population: { total: 200, strata: [
        { name: "low-stratum", size: 100, riskLevel: "low" },
        { name: "high-stratum", size: 100, riskLevel: "high" },
      ] },
    } });
    assert.equal(r.ok, true);
    const rw = r.result.stratifiedPlan.riskWeightedAllocation;
    const low = rw.find(s => s.stratum === "low-stratum");
    const high = rw.find(s => s.stratum === "high-stratum");
    // Equal sizes, weight 3 vs 1 → high stratum gets strictly more samples.
    assert.ok(high.allocatedSample > low.allocatedSample);
    assert.equal(high.riskWeight, 3);
  });

  it("samplingPlan: rejects a non-positive population", async () => {
    const r = await lensRun("audit", "samplingPlan", { data: { population: { total: 0 } } });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /population size must be positive/i);
  });

  it("frameworkCatalog: lists soc2 + iso27001 with their control counts", async () => {
    const r = await lensRun("audit", "frameworkCatalog", {});
    assert.equal(r.ok, true);
    const soc2 = r.result.frameworks.find(f => f.id === "soc2");
    assert.equal(soc2.controlCount, 12);
    assert.ok(r.result.frameworks.some(f => f.id === "iso27001"));
  });
});

describe("audit — compliance lifecycle (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-life"); });

  it("frameworkAdopt: adopts soc2 controls then re-adopt is idempotent", async () => {
    const first = await lensRun("audit", "frameworkAdopt", { params: { framework: "soc2" } }, ctx);
    assert.equal(first.result.added, 12);
    assert.equal(first.result.totalControls, 12);
    // Re-adopt: nothing new added (ref dedupe), total unchanged.
    const again = await lensRun("audit", "frameworkAdopt", { params: { framework: "soc2" } }, ctx);
    assert.equal(again.result.added, 0);
    assert.equal(again.result.totalControls, 12);
  });

  it("frameworkAdopt: rejects an unknown framework", async () => {
    const r = await lensRun("audit", "frameworkAdopt", { params: { framework: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /unknown framework/i);
  });

  it("controlUpdate: setting a control to pass round-trips into controlList summary", async () => {
    const listed = await lensRun("audit", "controlList", { params: { framework: "soc2" } }, ctx);
    const target = listed.result.controls[0];
    const upd = await lensRun("audit", "controlUpdate", { params: { id: target.id, status: "pass", owner: "sec-team" } }, ctx);
    assert.equal(upd.result.control.status, "pass");
    assert.equal(upd.result.control.owner, "sec-team");
    assert.ok(upd.result.control.lastAssessedAt);
    // Compliance rate now reflects 1 pass out of 1 assessable.
    const after = await lensRun("audit", "controlList", { params: { framework: "soc2" } }, ctx);
    assert.equal(after.result.summary.pass, 1);
    assert.equal(after.result.summary.complianceRate, 100);
  });

  it("controlUpdate: rejects an invalid status and an unknown control id", async () => {
    const listed = await lensRun("audit", "controlList", { params: { framework: "soc2" } }, ctx);
    const bad = await lensRun("audit", "controlUpdate", { params: { id: listed.result.controls[0].id, status: "wat" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /invalid status/i);
    const missing = await lensRun("audit", "controlUpdate", { params: { id: "ctl_nope", status: "pass" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(String(missing.result.error), /control not found/i);
  });

  it("evidenceDelete: add → delete → list round-trips to empty", async () => {
    const listed = await lensRun("audit", "controlList", { params: { framework: "soc2" } }, ctx);
    const ctlId = listed.result.controls[1].id;
    const added = await lensRun("audit", "evidenceAdd", { params: { controlId: ctlId, title: "screenshot of MFA", kind: "screenshot" } }, ctx);
    assert.equal(added.result.evidence.kind, "screenshot");
    const evId = added.result.evidence.id;
    const del = await lensRun("audit", "evidenceDelete", { params: { id: evId } }, ctx);
    assert.equal(del.result.deleted, evId);
    const after = await lensRun("audit", "evidenceList", { params: { controlId: ctlId } }, ctx);
    assert.equal(after.result.total, 0);
    assert.ok(!after.result.evidence.some(e => e.id === evId));
  });

  it("evidenceDelete: rejects a missing evidence id", async () => {
    const r = await lensRun("audit", "evidenceDelete", { params: { id: "evd_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /evidence not found/i);
  });
});

describe("audit — continuous monitoring (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-monitor"); });

  it("monitorRun: an enabled mfa check passes when all users enrolled and auto-updates the mapped control", async () => {
    await lensRun("audit", "frameworkAdopt", { params: { framework: "soc2" } }, ctx);
    await lensRun("audit", "monitorConfigure", { params: { checkId: "mfa_enforced", enabled: true, facts: { mfaUsers: 10, totalUsers: 10 } } }, ctx);
    const run = await lensRun("audit", "monitorRun", {}, ctx);
    const mfa = run.result.results.find(r => r.checkId === "mfa_enforced");
    assert.equal(mfa.passed, true);
    assert.equal(run.result.passed, 1);
    // CC6.1 maps to mfa_enforced → auto-flipped to pass.
    assert.ok(run.result.autoUpdatedControls >= 1);
    const ctls = await lensRun("audit", "controlList", { params: { framework: "soc2" } }, ctx);
    assert.ok(ctls.result.controls.some(c => c.ref === "CC6.1" && c.status === "pass"));
  });

  it("monitorRun: a failing fact (not all users enrolled) marks the check failed", async () => {
    await lensRun("audit", "monitorConfigure", { params: { checkId: "mfa_enforced", enabled: true, facts: { mfaUsers: 5, totalUsers: 10 } } }, ctx);
    const run = await lensRun("audit", "monitorRun", {}, ctx);
    const mfa = run.result.results.find(r => r.checkId === "mfa_enforced");
    assert.equal(mfa.passed, false);
    assert.match(String(mfa.reason), /5\/10/);
  });

  it("monitorConfigure: rejects an unknown check id", async () => {
    const r = await lensRun("audit", "monitorConfigure", { params: { checkId: "telepathy", enabled: true } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /unknown check/i);
  });
});

describe("audit — findings & vendors (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-fnd-ven"); });

  it("findingAdd → findingList: a critical finding sorts first and is counted by severity", async () => {
    await lensRun("audit", "findingAdd", { params: { title: "Low risk note", severity: "low" } }, ctx);
    const crit = await lensRun("audit", "findingAdd", { params: { title: "Open S3 bucket", severity: "critical" } }, ctx);
    assert.equal(crit.result.finding.severity, "critical");
    assert.equal(crit.result.finding.status, "open");
    const list = await lensRun("audit", "findingList", { params: {} }, ctx);
    assert.equal(list.result.summary.total, 2);
    assert.equal(list.result.summary.bySeverity.critical, 1);
    // Critical sorts ahead of low.
    assert.equal(list.result.findings[0].severity, "critical");
  });

  it("findingAdd: rejects a finding with no title", async () => {
    const r = await lensRun("audit", "findingAdd", { params: { severity: "high" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /title required/i);
  });

  it("findingUpdate: an overdue finding becomes not-overdue once closed", async () => {
    const added = await lensRun("audit", "findingAdd", { params: { title: "Patch server", severity: "high", dueDate: "2000-01-01" } }, ctx);
    const id = added.result.finding.id;
    const overdueList = await lensRun("audit", "findingList", { params: { severity: "high" } }, ctx);
    assert.ok(overdueList.result.findings.some(f => f.id === id && f.overdue === true));
    const upd = await lensRun("audit", "findingUpdate", { params: { id, status: "closed" } }, ctx);
    assert.equal(upd.result.finding.status, "closed");
    const closedList = await lensRun("audit", "findingList", { params: { status: "closed" } }, ctx);
    // Closed findings are never flagged overdue.
    assert.ok(closedList.result.findings.find(f => f.id === id).overdue === false);
  });

  it("vendorAdd: derives a high risk tier from critical data access + high criticality", async () => {
    const r = await lensRun("audit", "vendorAdd", { params: { name: "DataCo", dataAccess: "critical", criticality: "high" } }, ctx);
    // critical(4) + high(2) = 6 → high tier.
    assert.equal(r.result.vendor.riskScore, 6);
    assert.equal(r.result.vendor.riskTier, "high");
    assert.equal(r.result.vendor.status, "active");
  });

  it("vendorAdd: rejects a vendor with no name", async () => {
    const r = await lensRun("audit", "vendorAdd", { params: { dataAccess: "pii" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /name required/i);
  });

  it("vendorUpdate: lowering data access recomputes the risk tier downward", async () => {
    const added = await lensRun("audit", "vendorAdd", { params: { name: "ShrinkCo", dataAccess: "sensitive", criticality: "high" } }, ctx);
    // sensitive(3) + high(2) = 5 → high.
    assert.equal(added.result.vendor.riskTier, "high");
    const upd = await lensRun("audit", "vendorUpdate", { params: { id: added.result.vendor.id, dataAccess: "none", criticality: "low" } }, ctx);
    // none(0) + low(0) = 0 → low.
    assert.equal(upd.result.vendor.riskScore, 0);
    assert.equal(upd.result.vendor.riskTier, "low");
  });

  it("vendorList: filters by risk tier and sorts by descending risk score", async () => {
    const list = await lensRun("audit", "vendorList", { params: { riskTier: "high" } }, ctx);
    // Only high-tier vendors returned.
    assert.ok(list.result.vendors.every(v => v.riskTier === "high"));
    // DataCo (added above) is present.
    assert.ok(list.result.vendors.some(v => v.name === "DataCo"));
    assert.equal(list.result.summary.byTier.high, list.result.vendors.length);
  });
});

describe("audit — policy & report (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-pol-rpt"); });

  it("policyAdd → policyAccept: a second identical acceptance dedupes", async () => {
    const pol = await lensRun("audit", "policyAdd", { params: { title: "Acceptable Use", version: "2.0" } }, ctx);
    assert.equal(pol.result.policy.version, "2.0");
    const polId = pol.result.policy.id;
    const acc1 = await lensRun("audit", "policyAccept", { params: { policyId: polId, acceptedBy: "user@x.com" } }, ctx);
    assert.equal(acc1.result.acceptance.acceptedBy, "user@x.com");
    assert.ok(!acc1.result.duplicate);
    const acc2 = await lensRun("audit", "policyAccept", { params: { policyId: polId, acceptedBy: "user@x.com" } }, ctx);
    assert.equal(acc2.result.duplicate, true);
    const accList = await lensRun("audit", "policyAcceptanceList", { params: { policyId: polId } }, ctx);
    // Exactly one acceptance row despite two accept calls.
    assert.equal(accList.result.total, 1);
  });

  it("policyAccept: rejects acceptance with no acceptedBy", async () => {
    const pol = await lensRun("audit", "policyAdd", { params: { title: "Code of Conduct" } }, ctx);
    const r = await lensRun("audit", "policyAccept", { params: { policyId: pol.result.policy.id } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /acceptedby required/i);
  });

  it("exportReport: summary reflects adopted controls, findings and renders markdown", async () => {
    await lensRun("audit", "frameworkAdopt", { params: { framework: "iso27001" } }, ctx);
    await lensRun("audit", "findingAdd", { params: { title: "Critical gap", severity: "critical" } }, ctx);
    const r = await lensRun("audit", "exportReport", { params: { organization: "Acme" } }, ctx);
    assert.equal(r.result.report.organization, "Acme");
    // iso27001 has 12 controls.
    assert.equal(r.result.report.summary.totalControls, 12);
    assert.equal(r.result.report.summary.openFindings, 1);
    assert.equal(r.result.report.summary.criticalFindings, 1);
    // Markdown carries the org name and the executive-summary table.
    assert.match(r.result.markdown, /\*\*Organization:\*\* Acme/);
    assert.match(r.result.markdown, /Executive Summary/);
  });
});
