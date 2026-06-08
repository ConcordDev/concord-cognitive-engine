// tests/depth/security-behavior.test.js — REAL behavioral tests for the
// security domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs (CVSS→severity, risk scores,
// escalation tiers, scan findings) + CRUD round-trips + validation rejections.
//
// NB: security.accessAudit is covered separately in
// security-access-audit-behavior.test.js — this file does NOT re-test it.
//
// lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.
// Network-backed macros (feed, threat-enrich CVE branch) are exercised only on
// their deterministic local-only branches (threat-enrich IOC over the SIEM stream).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("security — calc contracts (exact computed values)", () => {
  it("threatMatrix: riskScore = severity × likelihood, sorted desc, leveled exactly", async () => {
    const r = await lensRun("security", "threatMatrix", {
      data: { threats: [
        { name: "Low", severity: 1, probability: 2 },      // 2 → low
        { name: "Crit", severity: 5, likelihood: 4 },      // 20 → critical
        { name: "Med", severity: 2, probability: 3 },      // 6 → medium
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalThreats, 3);
    assert.equal(r.result.criticalCount, 1);
    // Sorted by riskScore descending.
    assert.deepEqual(r.result.matrix.map((m) => m.name), ["Crit", "Med", "Low"]);
    assert.equal(r.result.matrix[0].riskScore, 20);
    assert.equal(r.result.matrix[0].riskLevel, "critical");
    assert.equal(r.result.matrix[1].riskScore, 6);
    assert.equal(r.result.matrix[1].riskLevel, "medium");
    assert.equal(r.result.matrix[2].riskScore, 2);
    assert.equal(r.result.matrix[2].riskLevel, "low");
  });

  it("threatAssessment: residualRisk discounts riskScore by control effectiveness", async () => {
    const r = await lensRun("security", "threatAssessment", {
      data: { threats: [{
        name: "Ransomware", probability: 4, impact: 5,
        vulnerabilities: ["unpatched-smb"],
        controls: [{ status: "active" }, { status: "inactive" }],  // 50% effective
      }] },
    });
    assert.equal(r.ok, true);
    const a = r.result.assessments[0];
    assert.equal(a.riskScore, 20);            // 4 × 5
    assert.equal(a.riskLevel, "critical");    // >= 20
    assert.equal(a.controlEffectiveness, 50); // 1 of 2 active
    assert.equal(a.residualRisk, 10);         // 20 × (1 − 0.5)
    assert.equal(a.vulnerabilities, 1);
    // probability>=4 and impact>=4 add proactive + continuity mitigations.
    assert.ok(a.mitigations.some((m) => m.toLowerCase().includes("monitoring")));
    assert.ok(a.mitigations.some((m) => m.toLowerCase().includes("continuity")));
    assert.equal(r.result.overallRiskScore, 20);
    assert.equal(r.result.criticalCount, 1);
  });

  it("incidentEscalate: escalationScore = severity × impactScore selects the tier + roles", async () => {
    const r = await lensRun("security", "incidentEscalate", {
      data: { severity: 5, impact: "critical", type: "breach" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.escalationScore, 25);        // 5 × 5 (critical impact)
    assert.equal(r.result.escalationLevel, "critical");
    assert.equal(r.result.requiredResponseTime, "15 minutes");
    assert.ok(r.result.notifications.some((n) => n.role === "ciso"));
    assert.equal(r.result.notifications[0].method, "phone_and_email");
  });

  it("incidentEscalate: a low-impact minor incident stays in the low tier", async () => {
    const r = await lensRun("security", "incidentEscalate", {
      data: { severity: 2, impact: "minimal", type: "noise" },
    });
    assert.equal(r.result.escalationScore, 2);   // 2 × 1
    assert.equal(r.result.escalationLevel, "low");
    assert.equal(r.result.requiredResponseTime, "24 hours");
    assert.deepEqual(r.result.notifications.map((n) => n.role), ["team_lead"]);
  });

  it("vulnerabilityScan: a disabled firewall + default creds + risky port surface exact findings", async () => {
    const r = await lensRun("security", "vulnerabilityScan", {
      data: { systems: [{
        name: "web-01",
        configurations: { firewall: false, defaultCredentials: true, encryption: true, mfa: false },
        openPorts: [80, 23, 443],                 // 23 (telnet) is risky
        certificates: [{ name: "old", expiryDate: "2000-01-01" }],
        accounts: [{ name: "svc", weakPassword: true }],
      }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.systemsScanned, 1);
    const detail = (s) => r.result.findings.some((f) => f.detail.includes(s));
    assert.ok(detail("Firewall disabled"));
    assert.ok(detail("Default credentials in use"));
    assert.ok(detail("Multi-factor authentication disabled"));
    assert.ok(detail("Risky port 23 is open"));
    assert.ok(detail("expired"));
    assert.ok(detail("weak password"));
    // exact severity tallies: 2 critical (firewall + default creds),
    // 3 high (mfa + expired cert + weak password), 1 medium (risky port).
    assert.equal(r.result.criticalCount, 2);
    assert.equal(r.result.highCount, 3);
    assert.equal(r.result.mediumCount, 1);
    assert.equal(r.result.totalFindings, 6);
  });

  it("vulnerabilityScan: a hardened system produces no findings", async () => {
    const r = await lensRun("security", "vulnerabilityScan", {
      data: { systems: [{
        name: "clean-01",
        configurations: { firewall: true, encryption: true, mfa: true },
        openPorts: [443],
        certificates: [],
        accounts: [{ name: "ok", passwordAge: 10 }],
      }] },
    });
    assert.equal(r.result.totalFindings, 0);
    assert.equal(r.result.criticalCount, 0);
  });

  it("incidentTrend: tallies incidents by type/location/month", async () => {
    const r = await lensRun("security", "incidentTrend", {
      data: { incidents: [
        { type: "theft", location: "lobby", date: "2026-01-15" },
        { type: "theft", location: "garage", date: "2026-01-20" },
        { type: "vandalism", location: "lobby", date: "2026-02-01" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalIncidents, 3);
    assert.equal(r.result.byType.theft, 2);
    assert.equal(r.result.byType.vandalism, 1);
    assert.equal(r.result.byLocation.lobby, 2);
    assert.equal(r.result.byMonth["2026-01"], 2);
    assert.equal(r.result.byMonth["2026-02"], 1);
  });

  it("patrolCoverage: coverage% = completed/total, missed checkpoints surfaced", async () => {
    const r = await lensRun("security", "patrolCoverage", {
      data: { checkpoints: [
        { location: "A", status: "completed" },
        { location: "B", checkedAt: "2026-06-07T01:00:00Z" },
        { location: "C", status: "pending", time: "02:00" },
        { location: "D", status: "pending", time: "03:00" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 4);
    assert.equal(r.result.completed, 2);
    assert.equal(r.result.coverage, 50);  // round(2/4 * 100)
    assert.equal(r.result.missed.length, 2);
    assert.ok(r.result.missed.some((m) => m.location === "C"));
  });

  it("evidenceChain: an out-of-sequence date breaks the chain of custody", async () => {
    const r = await lensRun("security", "evidenceChain", {
      data: { evidenceLog: [
        { handler: "Officer A", date: "2026-06-01" },
        { handler: "Officer B", date: "2026-05-30" },   // earlier than prior → out of sequence
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.intact, false);
    assert.equal(r.result.transfers, 2);
    assert.ok(r.result.issues.some((i) => i.issue.includes("out of sequence")));
  });

  it("evidenceChain: a complete in-order log is intact", async () => {
    const r = await lensRun("security", "evidenceChain", {
      data: { evidenceLog: [
        { handler: "A", date: "2026-06-01" },
        { handler: "B", date: "2026-06-02" },
      ] },
    });
    assert.equal(r.result.intact, true);
    assert.equal(r.result.issues.length, 0);
  });
});

describe("security — vuln/asset management round-trips + CVSS contracts", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("security-vuln-crud"); });

  it("vuln-add: CVSS 9.8 derives 'critical' severity and clamps to [0,10]", async () => {
    const add = await lensRun("security", "vuln-add", { params: { title: "Log4Shell", cveId: "CVE-2021-44228", cvss: 9.8, kev: true } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.vuln.severity, "critical");
    assert.equal(add.result.vuln.cvss, 9.8);
    assert.equal(add.result.vuln.status, "open");   // default
    const over = await lensRun("security", "vuln-add", { params: { title: "Clamped", cvss: 42 } }, ctx);
    assert.equal(over.result.vuln.cvss, 10);        // clamped to 10
    assert.equal(over.result.vuln.severity, "critical");
  });

  it("vuln-add: missing title is rejected", async () => {
    const bad = await lensRun("security", "vuln-add", { params: { cvss: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("vuln-list filters by severity + kev; sorted critical-first", async () => {
    const all = await lensRun("security", "vuln-list", {}, ctx);
    assert.ok(all.result.vulns.length >= 2);
    assert.equal(all.result.vulns[0].severity, "critical");  // sevRank sorts critical first
    const kev = await lensRun("security", "vuln-list", { params: { kev: true } }, ctx);
    assert.ok(kev.result.vulns.every((v) => v.kev === true));
    assert.ok(kev.result.vulns.some((v) => v.cveId === "CVE-2021-44228"));
  });

  it("vuln-update: lowering CVSS re-derives severity; round-trips through list", async () => {
    const add = await lensRun("security", "vuln-add", { params: { title: "Downgradable", cvss: 9.0 } }, ctx);
    const id = add.result.vuln.id;
    const upd = await lensRun("security", "vuln-update", { params: { id, cvss: 5.0, status: "triaged" } }, ctx);
    assert.equal(upd.result.vuln.cvss, 5.0);
    assert.equal(upd.result.vuln.severity, "medium");   // 4 <= 5 < 7
    assert.equal(upd.result.vuln.status, "triaged");
  });

  it("vuln-update: an unknown id is rejected", async () => {
    const bad = await lensRun("security", "vuln-update", { params: { id: "vln_nope", status: "open" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("asset-add → asset-list → vuln-add(affected) → asset-list shows openVulnCount", async () => {
    const fresh = await depthCtx("security-asset-link");
    const asset = await lensRun("security", "asset-add", { params: { name: "apache-httpd", vendor: "Apache", version: "2.4.49", type: "web", critical: true } }, fresh);
    assert.equal(asset.ok, true);
    const assetId = asset.result.asset.id;
    await lensRun("security", "vuln-add", { params: { title: "Path traversal", cvss: 7.5, affectedAssetIds: [assetId] } }, fresh);
    const list = await lensRun("security", "asset-list", {}, fresh);
    const a = list.result.assets.find((x) => x.id === assetId);
    assert.equal(a.openVulnCount, 1);   // open vuln counts against the asset
    assert.equal(list.result.count, 1);
  });

  it("asset-delete unlinks the asset from vuln records; missing id rejected", async () => {
    const fresh = await depthCtx("security-asset-del");
    const asset = await lensRun("security", "asset-add", { params: { name: "doomed" } }, fresh);
    const assetId = asset.result.asset.id;
    const v = await lensRun("security", "vuln-add", { params: { title: "linked", cvss: 8, affectedAssetIds: [assetId] } }, fresh);
    const del = await lensRun("security", "asset-delete", { params: { id: assetId } }, fresh);
    assert.equal(del.result.deleted, assetId);
    // The vuln's affectedAssetIds no longer reference the deleted asset.
    const vlist = await lensRun("security", "vuln-list", {}, fresh);
    const vuln = vlist.result.vulns.find((x) => x.id === v.result.vuln.id);
    assert.ok(!vuln.affectedAssetIds.includes(assetId));
    const bad = await lensRun("security", "asset-delete", { params: { id: "ast_nope" } }, fresh);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("vuln-delete removes it; missing id rejected", async () => {
    const fresh = await depthCtx("security-vuln-del");
    const v = await lensRun("security", "vuln-add", { params: { title: "to-delete", cvss: 3 } }, fresh);
    const del = await lensRun("security", "vuln-delete", { params: { id: v.result.vuln.id } }, fresh);
    assert.equal(del.result.deleted, v.result.vuln.id);
    const after = await lensRun("security", "vuln-list", {}, fresh);
    assert.ok(!after.result.vulns.some((x) => x.id === v.result.vuln.id));
    const bad = await lensRun("security", "vuln-delete", { params: { id: "vln_nope" } }, fresh);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("security-dashboard: riskScore weights severities exactly", async () => {
    const fresh = await depthCtx("security-dash");
    await lensRun("security", "asset-add", { params: { name: "host" } }, fresh);
    await lensRun("security", "vuln-add", { params: { title: "C", cvss: 9.5 } }, fresh);   // critical → 25
    await lensRun("security", "vuln-add", { params: { title: "H", cvss: 7.5 } }, fresh);   // high → 12
    await lensRun("security", "vuln-add", { params: { title: "M", cvss: 5.0 } }, fresh);   // medium → 4
    const d = await lensRun("security", "security-dashboard", {}, fresh);
    assert.equal(d.result.assets, 1);
    assert.equal(d.result.openVulns, 3);
    assert.equal(d.result.bySeverity.critical, 1);
    assert.equal(d.result.bySeverity.high, 1);
    assert.equal(d.result.bySeverity.medium, 1);
    assert.equal(d.result.riskScore, 41);    // 25 + 12 + 4
    assert.equal(d.result.posture, "needs-attention");  // 20 <= 41 < 50
  });

  it("cve-asset-match: a vuln title containing the asset vendor auto-links the asset", async () => {
    const fresh = await depthCtx("security-cve-match");
    const asset = await lensRun("security", "asset-add", { params: { name: "nginx-proxy", vendor: "nginx", version: "1.20.0", type: "proxy" } }, fresh);
    const v = await lensRun("security", "vuln-add", { params: { title: "nginx buffer overflow in 1.20.0", cvss: 8.1 } }, fresh);
    const m = await lensRun("security", "cve-asset-match", {}, fresh);
    assert.equal(m.result.totalMatches, 1);
    assert.equal(m.result.matches[0].vulnId, v.result.vuln.id);
    assert.ok(m.result.matches[0].affectedAssets.some((a) => a.id === asset.result.asset.id));
    // The match auto-linked the asset onto the vuln record.
    const vlist = await lensRun("security", "vuln-list", {}, fresh);
    const vuln = vlist.result.vulns.find((x) => x.id === v.result.vuln.id);
    assert.ok(vuln.affectedAssetIds.includes(asset.result.asset.id));
  });
});

describe("security — SIEM events + correlation + alert rules", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("security-siem"); });

  it("event-ingest: missing message is rejected", async () => {
    const bad = await lensRun("security", "event-ingest", { params: { source: "fw" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /message required/);
  });

  it("event-ingest → event-list filters by severity + query", async () => {
    await lensRun("security", "event-ingest", { params: { message: "failed login from attacker", severity: "high", srcIp: "10.0.0.5", user: "root" } }, ctx);
    await lensRun("security", "event-ingest", { params: { message: "info heartbeat", severity: "info", srcIp: "10.0.0.6" } }, ctx);
    const high = await lensRun("security", "event-list", { params: { severity: "high" } }, ctx);
    assert.ok(high.result.events.every((e) => e.severity === "high"));
    assert.ok(high.result.events.some((e) => e.message.includes("failed login")));
    const q = await lensRun("security", "event-list", { params: { query: "attacker" } }, ctx);
    assert.ok(q.result.events.some((e) => e.message.includes("attacker")));
  });

  it("event-correlate: clusters >= minEvents sharing a srcIp into one correlation", async () => {
    const fresh = await depthCtx("security-correlate");
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await lensRun("security", "event-ingest", { params: { message: `brute attempt ${i}`, severity: "high", srcIp: "192.0.2.10", ts: now } }, fresh);
    }
    const c = await lensRun("security", "event-correlate", { params: { windowMin: 120, minEvents: 3 } }, fresh);
    assert.equal(c.ok, true);
    const cor = c.result.correlations.find((x) => x.pivot === "ip:192.0.2.10");
    assert.ok(cor, "expected a correlation pivoting on the shared srcIp");
    assert.equal(cor.eventCount, 3);
    assert.equal(cor.peakSeverity, "high");
    assert.equal(cor.eventIds.length, 3);
  });

  it("rule-add: missing pattern is rejected; valid rule round-trips through rule-list", async () => {
    const badName = await lensRun("security", "rule-add", { params: { pattern: "x" } }, ctx);
    assert.equal(badName.result.ok, false);
    assert.match(badName.result.error, /name required/);
    const badPat = await lensRun("security", "rule-add", { params: { name: "no-pattern" } }, ctx);
    assert.equal(badPat.result.ok, false);
    assert.match(badPat.result.error, /pattern required/);
    const add = await lensRun("security", "rule-add", { params: { name: "Brute force", pattern: "failed login", field: "message", threshold: 2, incidentSeverity: "P2" } }, ctx);
    assert.equal(add.result.rule.incidentSeverity, "P2");
    const list = await lensRun("security", "rule-list", {}, ctx);
    assert.ok(list.result.rules.some((r) => r.id === add.result.rule.id));
  });

  it("rule-toggle flips enabled; rule-delete removes it", async () => {
    const add = await lensRun("security", "rule-add", { params: { name: "Toggle me", pattern: "x" } }, ctx);
    const id = add.result.rule.id;
    assert.equal(add.result.rule.enabled, true);
    const tog = await lensRun("security", "rule-toggle", { params: { id } }, ctx);
    assert.equal(tog.result.rule.enabled, false);
    const del = await lensRun("security", "rule-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("security", "rule-delete", { params: { id: "rul_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("rule-evaluate: a rule meeting its threshold auto-creates an incident", async () => {
    const fresh = await depthCtx("security-rule-eval");
    const now = new Date().toISOString();
    await lensRun("security", "event-ingest", { params: { message: "failed login attempt one", severity: "high", ts: now } }, fresh);
    await lensRun("security", "event-ingest", { params: { message: "failed login attempt two", severity: "high", ts: now } }, fresh);
    await lensRun("security", "rule-add", { params: { name: "Failed logins", pattern: "failed login", field: "message", minSeverity: "medium", threshold: 2, windowMin: 120, incidentSeverity: "P2" } }, fresh);
    const ev = await lensRun("security", "rule-evaluate", {}, fresh);
    assert.equal(ev.result.incidentsCreated, 1);
    assert.equal(ev.result.triggered[0].matchCount, 2);
    // The auto-created incident surfaces in incident-list.
    const incs = await lensRun("security", "incident-list", {}, fresh);
    assert.ok(incs.result.incidents.some((i) => i.origin === "alert-rule" && i.severity === "P2"));
  });

  it("rule-evaluate: a rule under threshold does NOT create an incident", async () => {
    const fresh = await depthCtx("security-rule-noeval");
    await lensRun("security", "event-ingest", { params: { message: "single failed login", severity: "high", ts: new Date().toISOString() } }, fresh);
    await lensRun("security", "rule-add", { params: { name: "Need 3", pattern: "failed login", threshold: 3, windowMin: 120 } }, fresh);
    const ev = await lensRun("security", "rule-evaluate", {}, fresh);
    assert.equal(ev.result.incidentsCreated, 0);
  });
});

describe("security — incident response + playbooks", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("security-ir"); });

  it("incident-open: missing title is rejected; valid incident round-trips", async () => {
    const bad = await lensRun("security", "incident-open", { params: { severity: "P1" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
    const open = await lensRun("security", "incident-open", { params: { title: "Data exfil", severity: "P1", assignee: "Alice" } }, ctx);
    assert.equal(open.result.incident.status, "detected");
    assert.equal(open.result.incident.severity, "P1");
    const list = await lensRun("security", "incident-list", { params: { open: true } }, ctx);
    assert.ok(list.result.incidents.some((i) => i.id === open.result.incident.id));
  });

  it("playbook-list returns the built-in malware playbook with its steps", async () => {
    const r = await lensRun("security", "playbook-list", {});
    assert.equal(r.ok, true);
    const malware = r.result.playbooks.find((p) => p.id === "malware");
    assert.ok(malware);
    assert.equal(malware.stepCount, malware.steps.length);
    assert.ok(malware.steps.some((s) => s.toLowerCase().includes("isolate")));
  });

  it("incident-attach-playbook → incident-advance completes a step and advances phase", async () => {
    const open = await lensRun("security", "incident-open", { params: { title: "Ransomware hit", severity: "P1" } }, ctx);
    const incidentId = open.result.incident.id;
    const att = await lensRun("security", "incident-attach-playbook", { params: { incidentId, playbookId: "malware" } }, ctx);
    assert.equal(att.result.incident.playbookId, "malware");
    assert.ok(att.result.incident.playbookSteps.length >= 1);
    const adv = await lensRun("security", "incident-advance", { params: { incidentId, completeStep: 0, phase: "contained", note: "host isolated" } }, ctx);
    assert.equal(adv.result.incident.playbookSteps[0].done, true);
    assert.equal(adv.result.incident.playbookStepIndex, 1);  // 1 step done
    assert.equal(adv.result.incident.phase, "contained");
    assert.ok(adv.result.updates.includes("step"));
    assert.ok(adv.result.updates.includes("phase"));
  });

  it("incident-advance to closed stamps closedAt and status closed", async () => {
    const open = await lensRun("security", "incident-open", { params: { title: "Closeable", severity: "P3" } }, ctx);
    const adv = await lensRun("security", "incident-advance", { params: { incidentId: open.result.incident.id, phase: "closed" } }, ctx);
    assert.equal(adv.result.incident.status, "closed");
    assert.ok(adv.result.incident.closedAt);
  });

  it("incident-attach-playbook: unknown playbook id is rejected", async () => {
    const open = await lensRun("security", "incident-open", { params: { title: "X" } }, ctx);
    const bad = await lensRun("security", "incident-attach-playbook", { params: { incidentId: open.result.incident.id, playbookId: "nonexistent" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown playbook/);
  });

  it("incident-advance: no valid update supplied is rejected", async () => {
    const open = await lensRun("security", "incident-open", { params: { title: "Y" } }, ctx);
    const bad = await lensRun("security", "incident-advance", { params: { incidentId: open.result.incident.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no valid update/);
  });
});

describe("security — badge audit + camera tiles + threat-enrich (local)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("security-badge"); });

  it("badge-event-add: missing badgeId/zone is rejected", async () => {
    const bad = await lensRun("security", "badge-event-add", { params: { holder: "Bob" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /badgeId and zone required/);
  });

  it("badge-audit: 3+ denials on a badge surface a repeated-denial anomaly", async () => {
    const fresh = await depthCtx("security-badge-deny");
    for (let i = 0; i < 3; i++) {
      await lensRun("security", "badge-event-add", { params: { badgeId: "B-007", zone: "vault", result: "denied", ts: "2026-06-07T12:00:00Z" } }, fresh);
    }
    const audit = await lensRun("security", "badge-audit", {}, fresh);
    assert.equal(audit.result.denialCount, 3);
    const anom = audit.result.anomalies.find((a) => a.kind === "repeated-denial" && a.badgeId === "B-007");
    assert.ok(anom);
    assert.equal(anom.count, 3);
  });

  it("badge-audit: a granted entry at 02:00 surfaces an after-hours anomaly", async () => {
    const fresh = await depthCtx("security-badge-ah");
    await lensRun("security", "badge-event-add", { params: { badgeId: "B-100", zone: "office", result: "granted", ts: "2026-06-07T02:30:00" } }, fresh);
    const audit = await lensRun("security", "badge-audit", {}, fresh);
    assert.ok(audit.result.anomalies.some((a) => a.kind === "after-hours" && a.badgeId === "B-100"));
  });

  it("camera-add → camera-list → camera-update → camera-delete round-trip", async () => {
    const fresh = await depthCtx("security-cam");
    const add = await lensRun("security", "camera-add", { params: { name: "Lobby Cam", zone: "lobby", kind: "ptz", motionDetection: true } }, fresh);
    assert.equal(add.result.camera.kind, "ptz");
    assert.equal(add.result.camera.status, "online");
    const id = add.result.camera.id;
    const list = await lensRun("security", "camera-list", {}, fresh);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.online, 1);
    const upd = await lensRun("security", "camera-update", { params: { id, status: "offline" } }, fresh);
    assert.equal(upd.result.camera.status, "offline");
    const del = await lensRun("security", "camera-delete", { params: { id } }, fresh);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("security", "camera-update", { params: { id: "cam_nope", status: "online" } }, fresh);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("camera-add: missing name is rejected", async () => {
    const bad = await lensRun("security", "camera-add", { params: { zone: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("threat-enrich (IOC, local SIEM): an IP seen >= 5 times scores 'malicious' reputation", async () => {
    const fresh = await depthCtx("security-enrich");
    for (let i = 0; i < 5; i++) {
      await lensRun("security", "event-ingest", { params: { message: `connect ${i}`, severity: "low", srcIp: "203.0.113.9" } }, fresh);
    }
    const r = await lensRun("security", "threat-enrich", { params: { ioc: "203.0.113.9" } }, fresh);
    assert.equal(r.ok, true);
    assert.equal(r.result.iocIntel.sightings, 5);
    assert.equal(r.result.iocIntel.reputation, "malicious");  // >= 5 sightings
  });

  it("threat-enrich: an unseen IOC scores 'unknown'", async () => {
    const fresh = await depthCtx("security-enrich-clean");
    const r = await lensRun("security", "threat-enrich", { params: { ioc: "198.51.100.250" } }, fresh);
    assert.equal(r.result.iocIntel.sightings, 0);
    assert.equal(r.result.iocIntel.reputation, "unknown");
  });

  it("threat-enrich: neither cveId nor ioc is rejected", async () => {
    const bad = await lensRun("security", "threat-enrich", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cveId or ioc required/);
  });
});
