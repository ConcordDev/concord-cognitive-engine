// Behavioral macro tests for the security lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — exactly what killed the welding/hvac
// calculator cards).
//
// Real channels exercised:
//   • ThreatVulnPanel.tsx → callSec(action, { artifact: { data } }) →
//       runDomain('security', action, { input: { artifact: { data } } }) →
//       dispatch peels the redundant artifact wrapper → handler reads
//       artifact.data.* (== `data` here). Drives the 2 pure calculators:
//       threatAssessment, vulnerabilityScan.
//   • security page action buttons → useRunArtifact → handler reads
//       artifact.data + params. Drives incidentEscalate + threatAssessment +
//       vulnerabilityScan + accessAudit (the result-panel renderers).
//
// This file asserts, field-for-field against
//   concord-frontend/components/security/ThreatVulnPanel.tsx and
//   concord-frontend/app/lenses/security/page.tsx (after the 2026-06-28
//   alignment fix):
//   - threatAssessment: assessments[].{name,riskLevel,riskScore,residualRisk,
//       controlEffectiveness,mitigations[]} + overallRiskScore/criticalCount/
//       highCount (page card)
//   - vulnerabilityScan: findings[].{system,severity,detail} + totalFindings +
//       criticalCount/highCount/mediumCount + bySeverity{} (the chip row that
//       was DEAD: the card read scanResult.bySeverity which the handler never
//       returned — fixed by emitting bySeverity with non-zero buckets only)
//   - incidentEscalate: escalationLevel/escalationScore/requiredResponseTime/
//       notifications[] (page card; P1..P5 string severity maps to 1..5)
//   - accessAudit: postureScore/rating/assetCount/openCritical/recommendations[]
//   - VALIDATION-REJECTION (missing-required state mutators)
//   - DEGRADE-GRACEFUL (pure calculators compute with STATE gone; STATE-backed
//       macros fail-soft, never throw)
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "1e999" / "abc"):
//       no NaN/Infinity leaks into any rendered risk score, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSecurityActions from "../domains/security.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "security", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both calculators (read art.data)
// and STATE macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`security.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: "art_sec_1", domain: "security", type: "domain_action", title: "Test artifact", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper ThreatVulnPanel.callSec builds before dispatch:
//   runDomain('security', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerSecurityActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "soc_a", id: "soc_a" }, userId: "soc_a" };

/* ───────── registration: every macro the lens channels drive ───────── */

describe("security lens — registration of the driven macros", () => {
  it("registers every macro the page + ThreatVulnPanel + VulnManager + SOCConsole call", () => {
    const driven = [
      // ThreatVulnPanel pure calculators
      "threatAssessment", "vulnerabilityScan",
      // page action buttons
      "incidentEscalate", "accessAudit",
      // page result-panel renderers (reachable via UniversalActions)
      "incidentTrend", "patrolCoverage", "threatMatrix", "evidenceChain",
      // VulnManager STATE-backed
      "asset-add", "asset-list", "asset-delete",
      "vuln-add", "vuln-list", "vuln-update", "vuln-delete", "security-dashboard",
      // SOCConsole STATE-backed
      "event-ingest", "event-list", "event-correlate",
      "rule-add", "rule-list", "rule-toggle", "rule-delete", "rule-evaluate",
      "incident-list", "incident-open", "playbook-list", "incident-attach-playbook", "incident-advance",
      "cve-asset-match", "badge-event-add", "badge-audit",
      "camera-add", "camera-list", "camera-update", "camera-delete",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing security.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("security lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a threatAssessment call sent the way ThreatVulnPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read
    // artifact.data.threats === undefined → [artifact.data] → a single junk
    // threat with default 3×3. Drive it through the exact double-wrap and
    // assert the REAL threats array landed.
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [{ name: "SQL injection", type: "web", probability: 4, impact: 5, vulnerabilities: ["v1", "v2"], controls: [{ status: "active" }, { status: "inactive" }] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.threatsAssessed, 1, "the real threats array must reach the handler, not the [artifact.data] fallback");
    assert.equal(r.result.assessments[0].name, "SQL injection");
  });
});

/* ───── threatAssessment: the EXACT fields the ThreatVulnPanel card renders ───── */

describe("security lens — threatAssessment (ThreatVulnPanel threat-risk card)", () => {
  it("returns assessments[].{name,riskLevel,riskScore,residualRisk,controlEffectiveness,mitigations[]} with real computed values", () => {
    // ThreatVulnPanel builds: probability/impact (1..5), vulnerabilities as an
    // array of length N, controls as [{status:'active'|'inactive'}].
    // prob 4 × impact 5 = 20 → riskScore 20 → critical
    // controls: 1 active of 2 → controlEffectiveness 50
    // residualRisk = 20 × (1 - 0.5) = 10
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [{
        name: "Ransomware", type: "malware", probability: 4, impact: 5,
        vulnerabilities: ["unpatched-rdp", "weak-backup"],
        controls: [{ status: "active" }, { status: "inactive" }],
      }],
    });
    assert.equal(r.ok, true);
    const a = r.result.assessments[0];
    assert.equal(a.name, "Ransomware");
    assert.equal(a.type, "malware");
    assert.equal(a.probability, 4);
    assert.equal(a.impact, 5);
    assert.equal(a.riskScore, 20);
    assert.equal(a.riskLevel, "critical");
    assert.equal(a.vulnerabilities, 2);
    assert.equal(a.existingControls, 2);
    assert.equal(a.controlEffectiveness, 50);
    assert.equal(a.residualRisk, 10);
    assert.ok(Array.isArray(a.mitigations) && a.mitigations.length >= 1);
    // page card rollup fields
    assert.equal(r.result.overallRiskScore, 20);
    assert.equal(r.result.overallRiskLevel, "critical");
    assert.equal(r.result.criticalCount, 1);
    assert.equal(r.result.highCount, 0);
  });

  it("a low-risk threat with full controls drops residual risk toward zero", () => {
    // prob 2 × impact 2 = 4 → riskScore 4 → low; both controls active → 100% →
    // residual 0
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [{ name: "Phishing", probability: 2, impact: 2, controls: [{ status: "active" }, { effective: true }] }],
    });
    const a = r.result.assessments[0];
    assert.equal(a.riskScore, 4);
    assert.equal(a.riskLevel, "low");
    assert.equal(a.controlEffectiveness, 100);
    assert.equal(a.residualRisk, 0);
  });

  it("multiple threats sort by riskScore descending (the card render order)", () => {
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [
        { name: "low", probability: 1, impact: 1 },
        { name: "high", probability: 5, impact: 5 },
        { name: "mid", probability: 3, impact: 3 },
      ],
    });
    assert.deepEqual(r.result.assessments.map((x) => x.name), ["high", "mid", "low"]);
  });
});

/* ───── vulnerabilityScan: findings + the bySeverity chip row (was DEAD) ───── */

describe("security lens — vulnerabilityScan (ThreatVulnPanel vulnerability-findings card)", () => {
  it("returns findings[].{system,severity,detail} + totalFindings + bySeverity{} with real values", () => {
    // ThreatVulnPanel builds systems as
    //   { name, configurations: { firewall, encryption, mfa, defaultCredentials } }
    // firewall=false → critical; defaultCredentials → critical;
    // encryption=false → high; mfa=false → high
    const r = callViaComponent("vulnerabilityScan", ctxA, {
      systems: [{
        name: "web-01",
        configurations: { firewall: false, encryption: false, mfa: false, defaultCredentials: true },
      }],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.systemsScanned, 1);
    assert.equal(res.totalFindings, 4);
    assert.equal(res.criticalCount, 2);
    assert.equal(res.highCount, 2);
    assert.equal(res.mediumCount, 0);
    // bySeverity — the chip row the card maps Object.entries() over. MUST be a
    // real object keyed by severity (this was the dead-card field).
    assert.equal(typeof res.bySeverity, "object");
    assert.equal(res.bySeverity.critical, 2);
    assert.equal(res.bySeverity.high, 2);
    assert.equal(res.bySeverity.medium, undefined, "zero buckets are omitted so the chip row stays clean");
    // findings[] — each carries the exact 3 fields the card renders
    assert.ok(Array.isArray(res.findings) && res.findings.length === 4);
    for (const f of res.findings) {
      assert.equal(typeof f.system, "string");
      assert.equal(typeof f.severity, "string");
      assert.equal(typeof f.detail, "string");
    }
    // critical findings sort first (the card render order)
    assert.equal(res.findings[0].severity, "critical");
    assert.ok(res.findings.some((f) => /Firewall disabled/.test(f.detail)));
    assert.ok(res.findings.some((f) => /Default credentials/.test(f.detail)));
  });

  it("a fully-hardened system yields zero findings + empty bySeverity (the clean state)", () => {
    const r = callViaComponent("vulnerabilityScan", ctxA, {
      systems: [{ name: "bastion", configurations: { firewall: true, encryption: true, mfa: true, defaultCredentials: false } }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFindings, 0);
    assert.deepEqual(r.result.findings, []);
    assert.deepEqual(r.result.bySeverity, {});
  });
});

/* ───── incidentEscalate: the page escalation card (P-scale severity) ───── */

describe("security lens — incidentEscalate (page escalation card)", () => {
  it("P1 critical incident → critical escalation with 15-minute SLA + role notifications", () => {
    // page artifact: severity is a P1..P5 STRING. P1 → 5; impact 'critical' → 5
    // → escalationScore 25 ≥ 20 → critical
    const r = call("incidentEscalate", ctxA, { severity: "P1", impact: "critical", type: "breach" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.escalationLevel, "critical");
    assert.equal(res.escalationScore, 25);
    assert.equal(res.requiredResponseTime, "15 minutes");
    assert.ok(Array.isArray(res.notifications) && res.notifications.length >= 1);
    for (const n of res.notifications) {
      assert.equal(typeof n.role, "string");
      assert.equal(typeof n.method, "string");
    }
    assert.ok(res.notifications.some((n) => n.role === "ciso"));
  });

  it("a low P5/low incident escalates to the low SLA tier", () => {
    // P5 → 1; impact 'low' → 2 → score 2 < 6 → low → 24h
    const r = call("incidentEscalate", ctxA, { severity: "P5", impact: "low" });
    assert.equal(r.result.escalationLevel, "low");
    assert.equal(r.result.requiredResponseTime, "24 hours");
  });
});

/* ───── accessAudit: posture score over STATE assets/vulns ───── */

describe("security lens — accessAudit (page Access Audit button)", () => {
  it("computes postureScore + rating + recommendations from real STATE vulns", () => {
    // seed: 1 open critical + 1 open high vuln via the real vuln-add macro
    const a = call("vuln-add", ctxA, { title: "RCE in nginx", cvss: 9.8 });
    assert.equal(a.ok, true);
    const b = call("vuln-add", ctxA, { title: "XSS in admin", cvss: 7.2 });
    assert.equal(b.ok, true);
    // posture: 100 - 20(crit) - 8(high) = 72 → moderate
    const r = call("accessAudit", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.vulnerabilityCount, 2);
    assert.equal(r.result.openCritical, 1);
    assert.equal(r.result.postureScore, 72);
    assert.equal(r.result.rating, "moderate");
    assert.ok(Array.isArray(r.result.recommendations) && r.result.recommendations.length >= 1);
    assert.ok(r.result.recommendations.some((x) => /critical/i.test(x)));
  });

  it("a clean tenant (no vulns, no assets) returns a strong/critical-band posture honestly", () => {
    const r = call("accessAudit", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.vulnerabilityCount, 0);
    assert.equal(r.result.openCritical, 0);
    assert.equal(r.result.postureScore, 100);
    assert.equal(r.result.rating, "strong");
    // honest: no assets inventoried surfaces a real recommendation
    assert.ok(r.result.recommendations.some((x) => /No assets inventoried/i.test(x)));
  });
});

/* ───── VALIDATION-REJECTION: required-field mutators reject cleanly ───── */

describe("security lens — validation rejection", () => {
  it("vuln-add with no title is rejected (not silently accepted)", () => {
    const r = call("vuln-add", ctxA, { cvss: 9 });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
    assert.match(r.error, /title required/);
  });

  it("asset-add with no name is rejected", () => {
    const r = call("asset-add", ctxA, { type: "service" });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });

  it("rule-add with no name OR no pattern is rejected", () => {
    assert.match(call("rule-add", ctxA, { pattern: "x" }).error, /name required/);
    assert.match(call("rule-add", ctxA, { name: "x" }).error, /pattern required/);
  });

  it("event-ingest with no message is rejected", () => {
    const r = call("event-ingest", ctxA, { severity: "high" });
    assert.equal(r.ok, false);
    assert.match(r.error, /message required/);
  });

  it("badge-event-add without badgeId or zone is rejected", () => {
    assert.match(call("badge-event-add", ctxA, { zone: "lobby" }).error, /badgeId and zone required/);
    assert.match(call("badge-event-add", ctxA, { badgeId: "b1" }).error, /badgeId and zone required/);
  });

  it("vuln-update on an unknown id is rejected", () => {
    const r = call("vuln-update", ctxA, { id: "does-not-exist", status: "remediated" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("security lens — fail-closed on poisoned numeric inputs", () => {
  it("threatAssessment: Infinity/NaN/'1e999' probability+impact can't leak a non-finite riskScore", () => {
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [
        { name: "poison-inf", probability: Infinity, impact: "1e999" },
        { name: "poison-nan", probability: NaN, impact: "abc" },
        { name: "poison-neg", probability: -50, impact: 99 },
      ],
    });
    assert.equal(r.ok, true);
    for (const a of r.result.assessments) {
      assert.ok(Number.isFinite(a.probability), `${a.name} probability ${a.probability} must be finite`);
      assert.ok(Number.isFinite(a.impact), `${a.name} impact ${a.impact} must be finite`);
      assert.ok(Number.isFinite(a.riskScore), `${a.name} riskScore ${a.riskScore} must be finite`);
      assert.ok(Number.isFinite(a.residualRisk), `${a.name} residualRisk must be finite`);
      // clamped into the 1..5 rating band
      assert.ok(a.probability >= 1 && a.probability <= 5);
      assert.ok(a.impact >= 1 && a.impact <= 5);
    }
    assert.ok(Number.isFinite(r.result.overallRiskScore), "overallRiskScore must be finite");
  });

  it("threatMatrix: Infinity severity/likelihood can't leak a non-finite riskScore", () => {
    const r = callViaComponent("threatMatrix", ctxA, {
      threats: [{ name: "x", severity: Infinity, probability: "Infinity" }],
    });
    assert.equal(r.ok, true);
    const m = r.result.matrix[0];
    assert.ok(Number.isFinite(m.severity));
    assert.ok(Number.isFinite(m.likelihood));
    assert.ok(Number.isFinite(m.riskScore));
    assert.ok(["critical", "high", "medium", "low"].includes(m.riskLevel));
  });

  it("incidentEscalate: a poisoned Infinity severity floors into the rating band, never NaN/Infinity score", () => {
    const r = call("incidentEscalate", ctxA, { severity: Infinity, impact: "critical" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.escalationScore), "escalationScore must be finite");
    assert.ok(["critical", "high", "medium", "low"].includes(r.result.escalationLevel));
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators stateless; STATE macros fail-soft ───── */

describe("security lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the pure scoring calculators DON'T need STATE — they still compute (never throw)", () => {
    let r;
    assert.doesNotThrow(() => { r = callViaComponent("threatAssessment", ctxA, { threats: [{ name: "x", probability: 3, impact: 3 }] }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = callViaComponent("vulnerabilityScan", ctxA, { systems: [{ name: "s", configurations: { firewall: false } }] }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("incidentEscalate", ctxA, { severity: "P2", impact: "high" }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = callViaComponent("threatMatrix", ctxA, { threats: [{ name: "y", severity: 3, probability: 3 }] }); });
    assert.equal(r.ok, true);
  });

  it("STATE-backed macros fail-soft with {ok:false, error:'STATE unavailable'} (no throw)", () => {
    const stateBacked = [
      ["asset-list", {}], ["vuln-list", {}], ["security-dashboard", {}],
      ["event-list", {}], ["rule-list", {}], ["incident-list", {}],
      ["camera-list", {}], ["accessAudit", {}], ["badge-audit", {}],
      ["event-correlate", {}], ["rule-evaluate", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.equal(r.error, "STATE unavailable", `${name} error`);
    }
  });
});
