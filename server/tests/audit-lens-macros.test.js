// Behavioral macro tests for the audit lens — the PHASE-2 LENS-DRIVEN GAP layer.
// These pin the EXACT field contract the live frontend surface drives, so a green
// test can never coexist with a dead-in-production calculator (the failure mode
// where a handler-ideal-shape test passes while the rendered component reads
// undefined fields — exactly what had silently killed the ENTIRE AuditActionPanel
// result-card surface here before the 2026-06-28 alignment fix).
//
// One real channel:
//   • AuditActionPanel.tsx → callMacro(action, { artifact: { data } }) →
//     apiHelpers.lens.runDomain('audit', action, { input: { artifact: { data } } })
//     → dispatch peels the redundant artifact wrapper → handler reads
//     artifact.data.* (== params here). Drives the 4 pure analytics calculators:
//     complianceCheck, trailAnalysis, riskScore, samplingPlan.
//   (The Vanta/Drata compliance-automation core — frameworkAdopt/controlList/
//    evidence/monitors/findings/policies/vendors/exportReport — is pinned by
//    audit-domain-parity.test.js, NOT duplicated here.)
//
// Asserted, with the EXACT input each calculator sends and the EXACT fields its
// result card renders (cross-checked field-for-field against
// components/audit/AuditActionPanel.tsx after the 2026-06-28 alignment fix):
//   - complianceCheck: framework / complianceRate / totalRequirements /
//     metRequirements / status / gaps[].{requirement,severity,remediation}
//     (was DEAD: card read framework/complianceRate/totalRequirements/
//     metRequirements/status/gaps — handler returned only overallComplianceRate/
//     totalRules/totalViolations/fieldGaps/ruleEffectiveness/recordResults →
//     every compliance card was blank but the shape test passed)
//   - trailAnalysis: totalEvents / anomalies[].{event,user,reason} /
//     userActivitySummary[].{user,eventCount} / suspiciousPatterns[]
//     (was DEAD: card read totalEvents/anomalies/userActivitySummary/
//     suspiciousPatterns — handler returned totalEntries/issues/actorSummary)
//   - riskScore: auditRisk / riskLevel / overallControlRisk / detectionRisk /
//     inherentRisk / controls[].{id,name,adjustedEffectiveness,controlRisk,
//     observedEffectiveness}  (was DEAD: card read flat overallControlRisk/
//     detectionRisk/inherentRisk/controls — handler returned nested components{}
//     + controlResults)
//   - samplingPlan: sampleSize / populationSize / confidenceLevel (PERCENT) /
//     expectedErrorRate / method / rationale  (was DEAD: card read sampleSize/
//     confidenceLevel/method/rationale and sent flat populationSize/
//     confidenceLevel(95)/tolerableErrorRate/expectedErrorRate percents — handler
//     read population.total + params.confidenceLevel(0.95) and returned
//     requiredSampleSize)
//   - VALIDATION-REJECTION: empty records / empty trail / zero population return
//     the empty-shape message, never a crash.
//   - DEGRADE-GRACEFUL: the 4 analytics calculators are stateless pure compute —
//     they compute even with globalThis._concordSTATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / "12abc"):
//     coercion is Number()+Number.isFinite (NOT parseFloat) so no NaN/Infinity
//     leaks into any rendered number, no crash, and a "12abc" prefix is REJECTED
//     to the default/clamp rather than silently accepted as 12.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAuditActions from "../domains/audit.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "audit", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So the calculators (read art.data) see
// the peeled input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`audit.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "audit", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper AuditActionPanel.callMacro builds before dispatch:
//   runDomain('audit', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double-wrap
// the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerAuditActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "audit_a", id: "audit_a" }, userId: "audit_a" };

// Helper: every numeric the component renders must be a real finite number
// (no NaN/Infinity leak). Strings are exempt; we scan only number-typed leaves.
function assertNoNonFiniteNumbers(obj, path = "result") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} leaked a non-finite number: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const [k, v] of Object.entries(obj)) assertNoNonFiniteNumbers(v, `${path}.${k}`); }
}

/* ───────── registration: every macro the lens channel drives ───────── */

describe("audit lens — registration of the driven calculators", () => {
  it("registers every macro AuditActionPanel drives", () => {
    for (const m of ["complianceCheck", "trailAnalysis", "riskScore", "samplingPlan"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing audit.${m}`);
    }
  });
});

/* ───── component { artifact: { data } } wrapper is peeled end-to-end ───── */

describe("audit lens — component double-wrap is peeled at dispatch", () => {
  it("a complianceCheck call sent the way AuditActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read undefined
    // records/rules and return the empty message — the silent-dead class. Drive
    // the exact double-wrap and assert the REAL records (2) landed.
    const r = callViaComponent("complianceCheck", ctxA, {
      framework: "SOC2",
      records: [
        { id: "r1", fields: { email: "a@b.com" } },
        { id: "r2", fields: { email: "a@b.com" } },
      ],
      rules: [{ id: "u1", name: "Email present", field: "email", type: "required" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRecords, 2, "the 2 real records must reach the handler (not the empty message)");
  });
});

/* ───────────────────── complianceCheck ───────────────────── */

describe("audit.complianceCheck — EXACT fields the CompResult card renders", () => {
  it("renders framework / complianceRate / totalRequirements / metRequirements / status / gaps with real computed values", () => {
    const r = callViaComponent("complianceCheck", ctxA, {
      framework: "SOC2",
      records: [
        { id: "r1", fields: { email: "a@b.com", age: 25, role: "admin" } },
        { id: "r2", fields: { email: "bad", age: 200, role: "ghost" } },
      ],
      rules: [
        { id: "rule_email", name: "Valid email", field: "email", type: "pattern", pattern: "^[^@]+@[^@]+$" },
        { id: "rule_age", name: "Age range", field: "age", type: "range", min: 0, max: 120 },
        { id: "rule_role", name: "Allowed role", field: "role", type: "enum", enumValues: ["admin", "user"] },
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    // EXACT rendered fields (card reads x.framework, x.complianceRate, x.metRequirements,
    // x.totalRequirements, x.status, x.gaps[].{requirement,severity}):
    assert.equal(x.framework, "SOC2");
    assert.equal(typeof x.complianceRate, "number");
    assert.equal(typeof x.totalRequirements, "number");
    assert.equal(typeof x.metRequirements, "number");
    assert.equal(typeof x.status, "string");
    assert.ok(Array.isArray(x.gaps), "gaps is the array the card maps");
    // real math: record r1 passes all 3 rules (100%), r2 fails all 3 (0%) →
    // overall = (100 + 0)/2 = 50.
    assert.equal(x.complianceRate, 50);
    assert.equal(x.totalRequirements, 3);
    // every one of the 3 rules triggers at least one violation → 0 met.
    assert.equal(x.metRequirements, 0);
    assert.equal(x.status, "non-compliant"); // < 80
    assert.equal(x.gaps.length, 3);
    for (const g of x.gaps) {
      assert.equal(typeof g.requirement, "string");
      assert.ok(["high", "medium", "low"].includes(g.severity));
      assert.equal(typeof g.remediation, "string");
    }
    // gap requirements are the rule names.
    const reqs = x.gaps.map((g) => g.requirement).sort();
    assert.deepEqual(reqs, ["Age range", "Allowed role", "Valid email"]);
    assertNoNonFiniteNumbers(x);
  });

  it("a fully-compliant population reads complianceRate 100 / status 'compliant' / metRequirements all / 0 gaps", () => {
    const r = callViaComponent("complianceCheck", ctxA, {
      framework: "ISO27001",
      records: [{ id: "r1", fields: { name: "ok", role: "user" } }],
      rules: [
        { id: "u1", name: "Name present", field: "name", type: "required" },
        { id: "u2", name: "Role allowed", field: "role", type: "enum", enumValues: ["admin", "user"] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.complianceRate, 100);
    assert.equal(r.result.status, "compliant");
    assert.equal(r.result.metRequirements, 2);
    assert.deepEqual(r.result.gaps, []);
    assert.equal(r.result.framework, "ISO27001");
    assertNoNonFiniteNumbers(r.result);
  });

  it("VALIDATION: no records → empty-shape message, never a crash", () => {
    const r = callViaComponent("complianceCheck", ctxA, { rules: [{ id: "u", name: "x", field: "x", type: "required" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No records to check.");
  });

  it("VALIDATION: records but no rules → empty-shape message", () => {
    const r = callViaComponent("complianceCheck", ctxA, { records: [{ id: "r", fields: { x: 1 } }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No compliance rules defined.");
  });
});

/* ───────────────────── trailAnalysis ───────────────────── */

describe("audit.trailAnalysis — EXACT fields the TrailResult card renders", () => {
  it("renders totalEvents / anomalies[].{event,user,reason} / userActivitySummary / suspiciousPatterns", () => {
    const r = callViaComponent("trailAnalysis", ctxA, {
      trail: [
        { sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z", actor: "alice", action: "create", objectId: "o1", hash: "h1" },
        { sequenceNumber: 3, timestamp: "2026-01-01T00:01:00Z", actor: "bob", action: "update", objectId: "o1", previousHash: "WRONG" },
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.totalEvents, "number");
    assert.equal(x.totalEvents, 2);
    assert.ok(Array.isArray(x.anomalies), "anomalies is the array the card maps");
    for (const a of x.anomalies) {
      assert.equal(typeof a.event, "string");
      assert.equal(typeof a.user, "string");
      assert.equal(typeof a.reason, "string");
    }
    // a sequence gap (1→3, expected 2) AND a hash-chain break are both detected.
    const events = x.anomalies.map((a) => a.event);
    assert.ok(events.includes("sequence-gap"), "the 1→3 gap surfaces as an anomaly");
    assert.ok(events.includes("hash-chain-break"), "the broken previousHash surfaces as an anomaly");
    // the hash-break anomaly resolves bob as its actor (from the sequence number).
    const hashBreak = x.anomalies.find((a) => a.event === "hash-chain-break");
    assert.equal(hashBreak.user, "bob");
    assert.ok(Array.isArray(x.userActivitySummary));
    assert.deepEqual(
      x.userActivitySummary.map((u) => u.user).sort(),
      ["alice", "bob"],
    );
    for (const u of x.userActivitySummary) assert.equal(typeof u.eventCount, "number");
    assert.ok(Array.isArray(x.suspiciousPatterns) && x.suspiciousPatterns.length > 0,
      "a broken hash chain surfaces at least one ↗ suspicious-pattern line");
    assertNoNonFiniteNumbers(x);
  });

  it("a clean, contiguous trail reads 0 anomalies and no suspicious patterns", () => {
    const r = callViaComponent("trailAnalysis", ctxA, {
      trail: [
        { sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z", actor: "alice", action: "create", hash: "h1" },
        { sequenceNumber: 2, timestamp: "2026-01-01T00:01:00Z", actor: "alice", action: "update", previousHash: "h1", hash: "h2" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
    assert.deepEqual(r.result.anomalies, []);
    assert.deepEqual(r.result.suspiciousPatterns, []);
    assert.equal(r.result.userActivitySummary[0].user, "alice");
    assert.equal(r.result.userActivitySummary[0].eventCount, 2);
  });

  it("VALIDATION: empty trail → empty-shape message, never a crash", () => {
    const r = callViaComponent("trailAnalysis", ctxA, { trail: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No audit trail entries provided.");
  });
});

/* ───────────────────── riskScore ───────────────────── */

describe("audit.riskScore — EXACT fields the RiskResult card renders", () => {
  it("renders auditRisk / riskLevel / overallControlRisk / detectionRisk / inherentRisk / controls with real computed values", () => {
    const r = callViaComponent("riskScore", ctxA, {
      controls: [
        { id: "c1", name: "Firewall", effectiveness: 0.9 },
        { id: "c2", name: "MFA", effectiveness: 0.8 },
      ],
      inherentRisks: [
        { id: "ir1", name: "Data breach", likelihood: 0.5, impact: 0.8, category: "security" },
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.auditRisk, "number");
    assert.equal(typeof x.riskLevel, "string");
    assert.equal(typeof x.overallControlRisk, "number");
    assert.equal(typeof x.detectionRisk, "number");
    assert.equal(typeof x.inherentRisk, "number");
    assert.ok(Array.isArray(x.controls), "controls is the array the card maps");
    for (const c of x.controls) {
      assert.equal(typeof c.adjustedEffectiveness, "number"); // required by RiskControlRow
      assert.equal(typeof c.controlRisk, "number"); // required by RiskControlRow
    }
    // real math:
    //   inherent risk = 0.5 * 0.8 = 0.4
    //   overall control risk = 1 - (0.9 * 0.8) = 0.28
    //   detection risk = 1 - mean(0.9, 0.8) = 1 - 0.85 = 0.15
    //   audit risk = 0.4 * 0.28 * 0.15 = 0.0168
    assert.equal(x.inherentRisk, 0.4);
    assert.equal(x.overallControlRisk, 0.28);
    assert.equal(x.detectionRisk, 0.15);
    assert.equal(x.auditRisk, 0.0168);
    // controls carry the exact RiskControlRow shape.
    const fw = x.controls.find((c) => c.id === "c1");
    assert.equal(fw.name, "Firewall");
    assert.equal(fw.adjustedEffectiveness, 0.9);
    assert.equal(fw.controlRisk, 0.1); // 1 - 0.9
    assert.equal(fw.observedEffectiveness, null); // no testResults
    assertNoNonFiniteNumbers(x);
  });

  it("VALIDATION: no controls / no inherent risks → finite default risk, never a crash", () => {
    const r = callViaComponent("riskScore", ctxA, { controls: [], inherentRisks: [] });
    assert.equal(r.ok, true);
    // defaults: inherent 0.5, detection 0.5, control 0 (empty product → 1 → 1-1=0).
    assert.ok(Number.isFinite(r.result.auditRisk));
    assert.ok(Number.isFinite(r.result.detectionRisk));
    assert.deepEqual(r.result.controls, []);
    assertNoNonFiniteNumbers(r.result);
  });
});

/* ───────────────────── samplingPlan ───────────────────── */

describe("audit.samplingPlan — EXACT fields the SamplingResult card renders", () => {
  it("renders sampleSize / populationSize / confidenceLevel(percent) / expectedErrorRate / method / rationale", () => {
    // AuditActionPanel.actSample sends FLAT percents:
    //   { populationSize:N, confidenceLevel:95, tolerableErrorRate:5, expectedErrorRate:1 }
    const r = callViaComponent("samplingPlan", ctxA, {
      populationSize: 10000, confidenceLevel: 95, tolerableErrorRate: 5, expectedErrorRate: 1,
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.sampleSize, "number");
    assert.equal(typeof x.populationSize, "number");
    assert.equal(typeof x.confidenceLevel, "number");
    assert.equal(typeof x.method, "string");
    assert.equal(typeof x.rationale, "string");
    // the card renders "{confidenceLevel}% confidence" → confidenceLevel is the PERCENT.
    assert.equal(x.confidenceLevel, 95);
    assert.equal(x.populationSize, 10000);
    assert.equal(x.expectedErrorRate, 1); // percent echoed back
    // real math: Z(0.95)=1.96, p=0.01, q=0.99, E=0.05
    //   infinite n = 1.96^2 * 0.01 * 0.99 / 0.05^2 = 3.8416*0.0099/0.0025 = 15.21 → 16
    //   finite ≈ 16 (negligible correction at N=10000)
    assert.equal(x.sampleSize, 16);
    assert.ok(/95% confidence/.test(x.rationale));
    assertNoNonFiniteNumbers(x);
  });

  it("a tighter tolerance (lower Tol %) yields a larger sample", () => {
    const loose = callViaComponent("samplingPlan", ctxA, { populationSize: 5000, confidenceLevel: 95, tolerableErrorRate: 10, expectedErrorRate: 5 });
    const tight = callViaComponent("samplingPlan", ctxA, { populationSize: 5000, confidenceLevel: 95, tolerableErrorRate: 2, expectedErrorRate: 5 });
    assert.equal(loose.ok, true);
    assert.equal(tight.ok, true);
    assert.ok(tight.result.sampleSize > loose.result.sampleSize, "±2% margin requires more samples than ±10%");
    assertNoNonFiniteNumbers(tight.result);
  });

  it("VALIDATION: non-positive population → empty-shape message, never a crash", () => {
    const r = callViaComponent("samplingPlan", ctxA, { populationSize: 0, confidenceLevel: 95, tolerableErrorRate: 5, expectedErrorRate: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Population size must be positive.");
  });
});

/* ───────── DEGRADE-GRACEFUL: pure compute survives STATE loss ───────── */

describe("audit lens — degrade-graceful (stateless analytics never throw)", () => {
  it("complianceCheck / trailAnalysis / riskScore / samplingPlan compute with STATE gone", () => {
    globalThis._concordSTATE = undefined;
    globalThis._concordSaveStateDebounced = undefined;
    const cases = [
      ["complianceCheck", { records: [{ id: "r", fields: { x: "v" } }], rules: [{ id: "u", name: "X present", field: "x", type: "required" }] }],
      ["trailAnalysis", { trail: [{ sequenceNumber: 1, timestamp: "2026-01-01", actor: "a", action: "x" }] }],
      ["riskScore", { controls: [{ id: "c", name: "c", effectiveness: 0.9 }], inherentRisks: [{ id: "i", name: "i", likelihood: 0.4, impact: 0.5 }] }],
      ["samplingPlan", { populationSize: 2000, confidenceLevel: 90, tolerableErrorRate: 5, expectedErrorRate: 2 }],
    ];
    for (const [name, data] of cases) {
      const r = callViaComponent(name, ctxA, data);
      assert.equal(r.ok, true, `${name} must degrade-graceful with no STATE`);
      assertNoNonFiniteNumbers(r.result);
    }
  });
});

/* ───────── FAIL-CLOSED: poisoned numerics never leak NaN/Infinity ───────── */

describe("audit lens — fail-CLOSED on poisoned numerics (Number.isFinite, not parseFloat)", () => {
  it("riskScore: 'Infinity' / 'NaN' / '12abc' effectiveness+likelihood+impact never leak a non-finite auditRisk", () => {
    // parseFloat("Infinity") === Infinity (0*Infinity = NaN downstream) and
    // parseFloat("12abc") === 12 (silent prefix accept). Number()+isFinite+clamp
    // rejects both.
    const r = callViaComponent("riskScore", ctxA, {
      controls: [{ id: "c", name: "c", effectiveness: "abc" }],
      inherentRisks: [{ id: "i", name: "i", likelihood: "NaN", impact: "Infinity" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.auditRisk), "auditRisk stays finite");
    assert.ok(Number.isFinite(r.result.overallControlRisk));
    assert.ok(Number.isFinite(r.result.detectionRisk));
    assert.ok(Number.isFinite(r.result.inherentRisk));
    assertNoNonFiniteNumbers(r.result);
    // "12abc" must NOT be coerced to 12 (parseFloat hazard) → rejected to 0.
    const r2 = callViaComponent("riskScore", ctxA, { controls: [{ id: "c", name: "c", effectiveness: "12abc" }], inherentRisks: [] });
    assert.equal(r2.result.controls[0].adjustedEffectiveness, 0, "'12abc' rejected to 0, not accepted as 12");
    assertNoNonFiniteNumbers(r2.result);
  });

  it("samplingPlan: poisoned populationSize/confidenceLevel/tolerableErrorRate never produce NaN/Infinity", () => {
    // 'Infinity' populationSize must NOT be accepted (parseFloat would) → treated
    // as non-positive → empty message.
    const r = callViaComponent("samplingPlan", ctxA, {
      populationSize: "Infinity", confidenceLevel: "NaN", tolerableErrorRate: "abc", expectedErrorRate: "12xyz",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Population size must be positive.", "'Infinity' rejected, not accepted as a real N");
    // a valid N but poisoned confidenceLevel → confidence falls to the 95% default,
    // sampleSize stays finite, no leak.
    const r2 = callViaComponent("samplingPlan", ctxA, { populationSize: 8000, confidenceLevel: "12abc", tolerableErrorRate: 5, expectedErrorRate: 1 });
    assert.equal(r2.result.confidenceLevel, 95, "'12abc' confidence rejected to 95% default, not accepted as 12");
    assert.ok(Number.isFinite(r2.result.sampleSize));
    assertNoNonFiniteNumbers(r2.result);
  });

  it("complianceCheck: a non-numeric 'range' field value is reported as a violation, never a NaN leak", () => {
    const r = callViaComponent("complianceCheck", ctxA, {
      framework: "SOC2",
      records: [{ id: "r1", fields: { age: "not-a-number" } }],
      rules: [{ id: "u", name: "Age range", field: "age", type: "range", min: 0, max: 120 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.complianceRate, 0); // the non-numeric value fails the range rule
    assert.equal(r.result.gaps.length, 1);
    assert.equal(r.result.gaps[0].requirement, "Age range");
    assertNoNonFiniteNumbers(r.result);
  });

  it("trailAnalysis: garbage timestamps degrade without NaN leaking into timeAnalysis or the card", () => {
    const r = callViaComponent("trailAnalysis", ctxA, {
      trail: [
        { sequenceNumber: 1, timestamp: "not-a-date", actor: "a", action: "x" },
        { sequenceNumber: 2, timestamp: "also-bad", actor: "a", action: "y" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
    assertNoNonFiniteNumbers(r.result);
  });
});
