import { fetchJsonWithTimeout } from "../lib/external-fetch.js";

// secFin — fail-CLOSED numeric coercion for the threat/incident scoring
// calculators. A poisoned input ("Infinity"/"1e999"/NaN/"abc") must NEVER leak
// a non-finite number into a rendered risk score. parseFloat("Infinity") is
// Infinity and `Infinity || fallback` keeps Infinity, so the bare `|| 3`
// patterns the scorers used were poisonable. This clamps to the 1..5 rating
// band the UI inputs are bounded to, falling back to `def` for anything
// non-finite or out of range.
function secFin(v, def, lo = 1, hi = 5) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return def;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export default function registerSecurityActions(registerLensAction) {
  registerLensAction("security", "incidentTrend", (ctx, artifact, _params) => {
    const incidents = artifact.data?.incidents || [artifact.data];
    const byType = {};
    const byLocation = {};
    const byMonth = {};
    incidents.forEach(inc => {
      const type = inc.type || 'unknown';
      const location = inc.location || 'unknown';
      const month = (inc.date || '').substring(0, 7) || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      byLocation[location] = (byLocation[location] || 0) + 1;
      byMonth[month] = (byMonth[month] || 0) + 1;
    });
    return { ok: true, result: { byType, byLocation, byMonth, totalIncidents: incidents.length, analyzedAt: new Date().toISOString() } };
  });

  registerLensAction("security", "patrolCoverage", (ctx, artifact, _params) => {
    const checkpoints = artifact.data?.checkpoints || [];
    if (checkpoints.length === 0) return { ok: true, result: { coverage: 0, completed: 0, total: 0 } };
    const completed = checkpoints.filter(cp => cp.status === 'completed' || cp.checkedAt).length;
    const coverage = Math.round((completed / checkpoints.length) * 100);
    const missed = checkpoints.filter(cp => cp.status !== 'completed' && !cp.checkedAt).map(cp => ({ location: cp.location, scheduledTime: cp.time }));
    return { ok: true, result: { patrol: artifact.title, coverage, completed, total: checkpoints.length, missed } };
  });

  registerLensAction("security", "threatMatrix", (ctx, artifact, _params) => {
    const threats = artifact.data?.threats || [artifact.data];
    const matrix = threats.map(t => {
      const severity = secFin(t.severity, 3);
      const likelihood = secFin(t.probability != null ? t.probability : t.likelihood, 3);
      const riskScore = severity * likelihood;
      return {
        name: t.name || artifact.title,
        type: t.type || 'unknown',
        severity,
        likelihood,
        riskScore,
        riskLevel: riskScore >= 15 ? 'critical' : riskScore >= 10 ? 'high' : riskScore >= 5 ? 'medium' : 'low',
        mitigations: t.mitigations || [],
      };
    }).sort((a, b) => b.riskScore - a.riskScore);
    return { ok: true, result: { matrix, totalThreats: matrix.length, criticalCount: matrix.filter(m => m.riskLevel === 'critical').length } };
  });

  registerLensAction("security", "incidentEscalate", (ctx, artifact, params) => {
  try {
    const incident = artifact.data || {};
    // severity may arrive as a P1..P5 string (page artifact) or a 1..5 number
    // (escalate panel). Map the P-scale to a numeric 1..5 (P1 = highest = 5),
    // then fail-closed so a poisoned "Infinity"/NaN can't leak into the score.
    const P_SCALE = { P1: 5, P2: 4, P3: 3, P4: 2, P5: 1 };
    const rawSeverity = incident.severity != null ? incident.severity : params.severity;
    const severity = typeof rawSeverity === "string" && P_SCALE[rawSeverity] != null
      ? P_SCALE[rawSeverity]
      : secFin(rawSeverity, 3);
    const impact = incident.impact || params.impact || 'medium';
    const type = incident.type || params.type || 'unknown';

    const impactScore = { critical: 5, high: 4, medium: 3, low: 2, minimal: 1 }[impact] || 3;
    const escalationScore = severity * impactScore;

    let level, responseTime, notifyRoles;
    if (escalationScore >= 20) {
      level = 'critical';
      responseTime = '15 minutes';
      notifyRoles = ['security_director', 'ciso', 'executive_team', 'incident_commander', 'legal'];
    } else if (escalationScore >= 12) {
      level = 'high';
      responseTime = '1 hour';
      notifyRoles = ['security_manager', 'incident_commander', 'team_lead'];
    } else if (escalationScore >= 6) {
      level = 'medium';
      responseTime = '4 hours';
      notifyRoles = ['security_manager', 'team_lead'];
    } else {
      level = 'low';
      responseTime = '24 hours';
      notifyRoles = ['team_lead'];
    }

    const notifications = notifyRoles.map(role => ({
      role,
      method: escalationScore >= 20 ? 'phone_and_email' : escalationScore >= 12 ? 'email_and_slack' : 'email',
      priority: level,
    }));

    return {
      ok: true,
      result: {
        incidentId: artifact.id,
        title: artifact.title,
        type,
        severity,
        impact,
        escalationScore,
        escalationLevel: level,
        requiredResponseTime: responseTime,
        notifications,
        escalatedAt: new Date().toISOString(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("security", "threatAssessment", (ctx, artifact, _params) => {
  try {
    const threats = artifact.data?.threats || [artifact.data];
    const assessments = threats.map(t => {
      const probability = secFin(t.probability != null ? t.probability : t.likelihood, 3);
      const impact = secFin(t.impact != null ? t.impact : t.severity, 3);
      const riskScore = Math.round(probability * impact * 100) / 100;
      const vulnerabilities = t.vulnerabilities || [];
      const existingControls = t.controls || t.mitigations || [];
      const controlEffectiveness = existingControls.length > 0
        ? Math.round(existingControls.filter(c => c.status === 'active' || c.effective).length / existingControls.length * 100)
        : 0;
      const residualRisk = Math.round(riskScore * (1 - controlEffectiveness / 100) * 100) / 100;

      const mitigations = [];
      if (residualRisk >= 15) mitigations.push('Implement immediate containment measures');
      if (vulnerabilities.length > 0) mitigations.push(`Address ${vulnerabilities.length} identified vulnerabilit${vulnerabilities.length === 1 ? 'y' : 'ies'}`);
      if (controlEffectiveness < 50) mitigations.push('Strengthen existing security controls');
      if (probability >= 4) mitigations.push('Deploy proactive monitoring and early warning systems');
      if (impact >= 4) mitigations.push('Develop and test business continuity plan');

      return {
        name: t.name || artifact.title,
        type: t.type || 'unknown',
        probability,
        impact,
        riskScore,
        riskLevel: riskScore >= 20 ? 'critical' : riskScore >= 12 ? 'high' : riskScore >= 6 ? 'medium' : 'low',
        vulnerabilities: vulnerabilities.length,
        existingControls: existingControls.length,
        controlEffectiveness,
        residualRisk,
        mitigations,
      };
    }).sort((a, b) => b.riskScore - a.riskScore);

    const overallRisk = assessments.length > 0 ? Math.round(assessments.reduce((s, a) => s + a.riskScore, 0) / assessments.length * 100) / 100 : 0;

    return {
      ok: true,
      result: {
        assessedAt: new Date().toISOString(),
        threatsAssessed: assessments.length,
        overallRiskScore: overallRisk,
        overallRiskLevel: overallRisk >= 20 ? 'critical' : overallRisk >= 12 ? 'high' : overallRisk >= 6 ? 'medium' : 'low',
        criticalCount: assessments.filter(a => a.riskLevel === 'critical').length,
        highCount: assessments.filter(a => a.riskLevel === 'high').length,
        assessments,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("security", "vulnerabilityScan", (ctx, artifact, _params) => {
  try {
    const systems = artifact.data?.systems || artifact.data?.assets || [artifact.data];
    const findings = [];

    for (const sys of systems) {
      const sysName = sys.name || sys.hostname || artifact.title;

      // Check configurations
      const configs = sys.configurations || sys.config || {};
      if (configs.firewall === false || configs.firewallEnabled === false) {
        findings.push({ system: sysName, type: 'configuration', severity: 'critical', detail: 'Firewall disabled' });
      }
      if (configs.defaultCredentials || configs.defaultPassword) {
        findings.push({ system: sysName, type: 'weak_password', severity: 'critical', detail: 'Default credentials in use' });
      }
      if (configs.encryption === false || configs.encryptionEnabled === false) {
        findings.push({ system: sysName, type: 'configuration', severity: 'high', detail: 'Encryption disabled' });
      }
      if (configs.mfa === false || configs.mfaEnabled === false) {
        findings.push({ system: sysName, type: 'configuration', severity: 'high', detail: 'Multi-factor authentication disabled' });
      }

      // Expired certificates
      const certs = sys.certificates || [];
      const now = new Date();
      for (const cert of certs) {
        const expiry = cert.expiryDate ? new Date(cert.expiryDate) : null;
        if (expiry && expiry < now) {
          findings.push({ system: sysName, type: 'expired_cert', severity: 'high', detail: `Certificate '${cert.name || cert.domain || 'unknown'}' expired ${cert.expiryDate}` });
        } else if (expiry) {
          const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 30) {
            findings.push({ system: sysName, type: 'expiring_cert', severity: 'medium', detail: `Certificate '${cert.name || cert.domain || 'unknown'}' expires in ${daysLeft} days` });
          }
        }
      }

      // Open ports
      const openPorts = sys.openPorts || sys.ports || [];
      const riskyPorts = [21, 23, 25, 135, 139, 445, 3389];
      for (const port of openPorts) {
        const portNum = typeof port === 'object' ? port.port : port;
        if (riskyPorts.includes(portNum)) {
          findings.push({ system: sysName, type: 'open_port', severity: 'medium', detail: `Risky port ${portNum} is open` });
        }
      }

      // Weak passwords
      const accounts = sys.accounts || sys.users || [];
      for (const acct of accounts) {
        if (acct.passwordAge && acct.passwordAge > 90) {
          findings.push({ system: sysName, type: 'weak_password', severity: 'medium', detail: `Account '${acct.name || acct.username}' password age: ${acct.passwordAge} days` });
        }
        if (acct.weakPassword || acct.passwordStrength === 'weak') {
          findings.push({ system: sysName, type: 'weak_password', severity: 'high', detail: `Account '${acct.name || acct.username}' has weak password` });
        }
      }
    }

    findings.sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2, low: 3 };
      // `sev[x] ?? 4` — NOT `|| 4`: critical's rank is 0, and `0 || 4` collapses
      // to 4, which sorted criticals LAST. Use nullish coalescing so rank 0 is
      // honored and criticals sort first (the order the findings card renders).
      return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4);
    });

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;
    const mediumCount = findings.filter(f => f.severity === 'medium').length;
    const lowCount = findings.filter(f => f.severity === 'low').length;
    return {
      ok: true,
      result: {
        scannedAt: new Date().toISOString(),
        systemsScanned: systems.length,
        totalFindings: findings.length,
        criticalCount,
        highCount,
        mediumCount,
        // bySeverity — the ThreatVulnPanel "Vulnerability findings" card renders
        // Object.entries(scanResult.bySeverity) as severity-count chips. Without
        // this object the chips silently render nothing (the dead-card class).
        // Only non-zero buckets are surfaced so the chip row stays uncluttered.
        bySeverity: Object.fromEntries(
          Object.entries({ critical: criticalCount, high: highCount, medium: mediumCount, low: lowCount })
            .filter(([, n]) => n > 0),
        ),
        findings,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("security", "evidenceChain", (ctx, artifact, _params) => {
    const evidenceLog = artifact.data?.evidenceLog || [];
    let intact = true;
    const issues = [];
    for (let i = 0; i < evidenceLog.length; i++) {
      const entry = evidenceLog[i];
      if (!entry.handler || !entry.date) {
        intact = false;
        issues.push({ position: i, issue: 'Missing handler or date', entry });
      }
      if (i > 0 && entry.date < evidenceLog[i - 1].date) {
        intact = false;
        issues.push({ position: i, issue: 'Date out of sequence', entry });
      }
    }
    return { ok: true, result: { investigationId: artifact.id, intact, transfers: evidenceLog.length, issues, verifiedAt: new Date().toISOString() } };
  });

  // ─── Vulnerability management substrate (OpenCVE / NVD-shape) ────────

  function getSecurityState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.securityLens) STATE.securityLens = {};
    const s = STATE.securityLens;
    if (!(s.assets instanceof Map)) s.assets = new Map(); // userId -> Array
    if (!(s.vulns instanceof Map)) s.vulns = new Map();   // userId -> Array
    return s;
  }
  function saveSecurity() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const secId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const secActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const secClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const secNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const secAssets = (s, userId) => { if (!s.assets.has(userId)) s.assets.set(userId, []); return s.assets.get(userId); };
  const secVulns = (s, userId) => { if (!s.vulns.has(userId)) s.vulns.set(userId, []); return s.vulns.get(userId); };
  const VULN_STATUS = ["open", "triaged", "in_progress", "remediated", "accepted"];
  function severityOf(cvss) {
    if (cvss == null) return "unknown";
    if (cvss >= 9) return "critical";
    if (cvss >= 7) return "high";
    if (cvss >= 4) return "medium";
    return "low";
  }

  registerLensAction("security", "asset-add", (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = secClean(params.name, 160);
    if (!name) return { ok: false, error: "asset name required" };
    const asset = {
      id: secId("ast"), name,
      type: secClean(params.type, 60) || "service",
      vendor: secClean(params.vendor, 120) || null,
      version: secClean(params.version, 60) || null,
      critical: params.critical === true,
      createdAt: new Date().toISOString(),
    };
    secAssets(s, secActor(ctx)).push(asset);
    saveSecurity();
    return { ok: true, result: { asset } };
  });

  registerLensAction("security", "asset-list", (ctx, _a, _params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const vulns = secVulns(s, userId);
    const assets = secAssets(s, userId).map((a) => ({
      ...a, openVulnCount: vulns.filter((v) => v.affectedAssetIds.includes(a.id) && v.status !== "remediated" && v.status !== "accepted").length,
    }));
    return { ok: true, result: { assets, count: assets.length } };
  });

  registerLensAction("security", "asset-delete", (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const arr = secAssets(s, userId);
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "asset not found" };
    arr.splice(i, 1);
    for (const v of secVulns(s, userId)) v.affectedAssetIds = v.affectedAssetIds.filter((id) => id !== params.id);
    saveSecurity();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("security", "vuln-add", (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = secClean(params.title, 240);
    if (!title) return { ok: false, error: "vulnerability title required" };
    const cvss = secNum(params.cvss);
    const vuln = {
      id: secId("vln"),
      cveId: secClean(params.cveId, 30) || null,
      title,
      cvss: cvss != null ? Math.max(0, Math.min(10, cvss)) : null,
      severity: severityOf(cvss),
      status: VULN_STATUS.includes(params.status) ? params.status : "open",
      affectedAssetIds: Array.isArray(params.affectedAssetIds) ? params.affectedAssetIds.map(String).slice(0, 50) : [],
      kev: params.kev === true,
      notes: secClean(params.notes, 2000) || "",
      createdAt: new Date().toISOString(),
    };
    secVulns(s, secActor(ctx)).push(vuln);
    saveSecurity();
    return { ok: true, result: { vuln } };
  });

  registerLensAction("security", "vuln-list", (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let vulns = [...secVulns(s, secActor(ctx))];
    if (params.status && VULN_STATUS.includes(params.status)) vulns = vulns.filter((v) => v.status === params.status);
    if (params.severity) vulns = vulns.filter((v) => v.severity === params.severity);
    if (params.kev) vulns = vulns.filter((v) => v.kev);
    const sevRank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
    vulns.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || ((b.cvss || 0) - (a.cvss || 0)));
    return { ok: true, result: { vulns, count: vulns.length } };
  });

  registerLensAction("security", "vuln-update", (ctx, _a, params = {}) => {
  try {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vuln = secVulns(s, secActor(ctx)).find((v) => v.id === params.id);
    if (!vuln) return { ok: false, error: "vulnerability not found" };
    if (params.status != null && VULN_STATUS.includes(params.status)) vuln.status = params.status;
    if (params.notes != null) vuln.notes = secClean(params.notes, 2000);
    if (params.cvss != null) { const c = secNum(params.cvss); if (c != null) { vuln.cvss = Math.max(0, Math.min(10, c)); vuln.severity = severityOf(vuln.cvss); } }
    if (Array.isArray(params.affectedAssetIds)) vuln.affectedAssetIds = params.affectedAssetIds.map(String).slice(0, 50);
    saveSecurity();
    return { ok: true, result: { vuln } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("security", "vuln-delete", (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = secVulns(s, secActor(ctx));
    const i = arr.findIndex((v) => v.id === params.id);
    if (i < 0) return { ok: false, error: "vulnerability not found" };
    arr.splice(i, 1);
    saveSecurity();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("security", "security-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const vulns = secVulns(s, userId);
    const open = vulns.filter((v) => v.status !== "remediated" && v.status !== "accepted");
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    for (const v of open) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    const riskScore = Math.min(100, bySeverity.critical * 25 + bySeverity.high * 12 + bySeverity.medium * 4 + bySeverity.low * 1);
    return {
      ok: true,
      result: {
        assets: secAssets(s, userId).length,
        totalVulns: vulns.length,
        openVulns: open.length,
        bySeverity,
        kev: open.filter((v) => v.kev).length,
        riskScore,
        posture: riskScore >= 50 ? "at-risk" : riskScore >= 20 ? "needs-attention" : "healthy",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest the latest published CVEs (CIRCL CVE-Search, free) as DTUs.
  registerLensAction("security", "feed", async (ctx, _a, params = {}) => {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch("https://cve.circl.lu/api/last");
      if (!r.ok) return { ok: false, error: `circl ${r.status}` };
      const data = await r.json();
      const cves = (Array.isArray(data) ? data : []).slice(0, limit);
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const c of cves) {
        const cveId = c.id || c.cveMetadata?.cveId;
        if (!cveId || s.feedSeen.has(cveId)) { skipped++; continue; }
        const summary = c.summary || c.containers?.cna?.descriptions?.[0]?.value || "(no summary)";
        const cvss = secNum(c.cvss);
        const title = `${cveId} — ${severityOf(cvss)} (CVSS ${cvss ?? "?"})`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${cveId}\nCVSS: ${cvss ?? "unscored"} (${severityOf(cvss)})\n\n${String(summary).slice(0, 800)}`,
          tags: ["security", "feed", "cve", severityOf(cvss)],
          source: "circl-cve-feed",
          meta: { cveId, cvss, severity: severityOf(cvss) },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(cveId); }
      }
      saveSecurity();
      return { ok: true, result: { ingested, skipped, source: "circl-cve-search", dtuIds } };
    } catch (e) {
      return { ok: false, error: `circl unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /* ================================================================ *
   *  SOC console parity backlog                                       *
   *  ─ SIEM event pipeline + correlation                              *
   *  ─ Incident response playbooks                                    *
   *  ─ Alert rules engine                                             *
   *  ─ CVE-to-asset matching                                          *
   *  ─ Access-control / badge audit                                   *
   *  ─ Surveillance camera tiles                                      *
   *  ─ EPSS + IOC threat-intel enrichment                             *
   * ================================================================ */

  function secEvents(s, userId) { if (!s.events.has(userId)) s.events.set(userId, []); return s.events.get(userId); }
  function secRules(s, userId) { if (!s.rules.has(userId)) s.rules.set(userId, []); return s.rules.get(userId); }
  function secIncidents(s, userId) { if (!s.incidents.has(userId)) s.incidents.set(userId, []); return s.incidents.get(userId); }
  function secCameras(s, userId) { if (!s.cameras.has(userId)) s.cameras.set(userId, []); return s.cameras.get(userId); }
  function secBadgeEvents(s, userId) { if (!s.badgeEvents.has(userId)) s.badgeEvents.set(userId, []); return s.badgeEvents.get(userId); }

  // re-bind STATE shape (extend the existing getSecurityState lazily)
  function getSecState() {
    const s = getSecurityState();
    if (!s) return null;
    if (!(s.events instanceof Map)) s.events = new Map();
    if (!(s.rules instanceof Map)) s.rules = new Map();
    if (!(s.incidents instanceof Map)) s.incidents = new Map();
    if (!(s.cameras instanceof Map)) s.cameras = new Map();
    if (!(s.badgeEvents instanceof Map)) s.badgeEvents = new Map();
    return s;
  }

  const EVENT_SEVERITY = ["info", "low", "medium", "high", "critical"];
  const sevRankE = (sv) => ({ info: 0, low: 1, medium: 2, high: 3, critical: 4 }[sv] ?? 0);

  // ── SIEM: ingest a single security event/log line ────────────────
  registerLensAction("security", "event-ingest", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const message = secClean(params.message, 1000);
    if (!message) return { ok: false, error: "event message required" };
    const ev = {
      id: secId("evt"),
      source: secClean(params.source, 120) || "manual",
      category: secClean(params.category, 60) || "log",
      severity: EVENT_SEVERITY.includes(params.severity) ? params.severity : "info",
      message,
      srcIp: secClean(params.srcIp, 64) || null,
      user: secClean(params.user, 120) || null,
      host: secClean(params.host, 160) || null,
      ts: params.ts ? new Date(params.ts).toISOString() : new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      correlationId: null,
    };
    const arr = secEvents(s, secActor(ctx));
    arr.push(ev);
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    saveSecurity();
    return { ok: true, result: { event: ev } };
  });

  // ── SIEM: list / search events ───────────────────────────────────
  registerLensAction("security", "event-list", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let events = [...secEvents(s, secActor(ctx))];
    if (params.severity && EVENT_SEVERITY.includes(params.severity)) events = events.filter((e) => e.severity === params.severity);
    if (params.source) events = events.filter((e) => e.source === params.source);
    if (params.query) {
      const q = String(params.query).toLowerCase();
      events = events.filter((e) => e.message.toLowerCase().includes(q) || (e.srcIp || "").includes(q) || (e.user || "").toLowerCase().includes(q));
    }
    events.sort((a, b) => (b.ts > a.ts ? 1 : -1));
    const limit = Math.max(1, Math.min(500, Math.round(Number(params.limit) || 200)));
    return { ok: true, result: { events: events.slice(0, limit), count: events.length } };
  });

  // ── SIEM: correlation — cluster events sharing srcIp/user/host ────
  registerLensAction("security", "event-correlate", (ctx, _a, params = {}) => {
  try {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const events = secEvents(s, secActor(ctx));
    const windowMin = Math.max(1, Math.min(1440, Math.round(Number(params.windowMin) || 60)));
    const minEvents = Math.max(2, Math.round(Number(params.minEvents) || 3));
    const cutoff = Date.now() - windowMin * 60_000;
    const recent = events.filter((e) => new Date(e.ts).getTime() >= cutoff);
    const groups = new Map();
    for (const e of recent) {
      for (const key of [e.srcIp && `ip:${e.srcIp}`, e.user && `user:${e.user}`, e.host && `host:${e.host}`].filter(Boolean)) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
    }
    const correlations = [];
    for (const [key, evs] of groups) {
      if (evs.length < minEvents) continue;
      const maxSev = evs.reduce((m, e) => Math.max(m, sevRankE(e.severity)), 0);
      const cid = secId("cor");
      for (const e of evs) e.correlationId = cid;
      correlations.push({
        correlationId: cid,
        pivot: key,
        eventCount: evs.length,
        peakSeverity: EVENT_SEVERITY[maxSev],
        firstSeen: evs.reduce((a, e) => (e.ts < a ? e.ts : a), evs[0].ts),
        lastSeen: evs.reduce((a, e) => (e.ts > a ? e.ts : a), evs[0].ts),
        eventIds: evs.map((e) => e.id),
        categories: [...new Set(evs.map((e) => e.category))],
      });
    }
    correlations.sort((a, b) => sevRankE(b.peakSeverity) - sevRankE(a.peakSeverity) || b.eventCount - a.eventCount);
    saveSecurity();
    return { ok: true, result: { correlations, windowMin, eventsAnalyzed: recent.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Alert rules engine: create a detection rule ──────────────────
  registerLensAction("security", "rule-add", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = secClean(params.name, 160);
    if (!name) return { ok: false, error: "rule name required" };
    const pattern = secClean(params.pattern, 240);
    if (!pattern) return { ok: false, error: "rule pattern required" };
    const rule = {
      id: secId("rul"),
      name,
      pattern,
      field: ["message", "srcIp", "user", "host", "category", "source"].includes(params.field) ? params.field : "message",
      minSeverity: EVENT_SEVERITY.includes(params.minSeverity) ? params.minSeverity : "info",
      threshold: Math.max(1, Math.round(Number(params.threshold) || 1)),
      windowMin: Math.max(1, Math.min(1440, Math.round(Number(params.windowMin) || 60))),
      incidentSeverity: ["P1", "P2", "P3", "P4", "P5"].includes(params.incidentSeverity) ? params.incidentSeverity : "P3",
      enabled: params.enabled !== false,
      createdAt: new Date().toISOString(),
      lastFiredAt: null,
      fireCount: 0,
    };
    secRules(s, secActor(ctx)).push(rule);
    saveSecurity();
    return { ok: true, result: { rule } };
  });

  registerLensAction("security", "rule-list", (ctx, _a, _params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rules = [...secRules(s, secActor(ctx))];
    return { ok: true, result: { rules, count: rules.length } };
  });

  registerLensAction("security", "rule-delete", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = secRules(s, secActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "rule not found" };
    arr.splice(i, 1);
    saveSecurity();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("security", "rule-toggle", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rule = secRules(s, secActor(ctx)).find((r) => r.id === params.id);
    if (!rule) return { ok: false, error: "rule not found" };
    rule.enabled = !rule.enabled;
    saveSecurity();
    return { ok: true, result: { rule } };
  });

  // ── Alert rules engine: evaluate all rules against the event stream
  //    matched rules that meet threshold auto-create incidents.
  registerLensAction("security", "rule-evaluate", (ctx, _a, _params = {}) => {
  try {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const events = secEvents(s, userId);
    const rules = secRules(s, userId);
    const incidents = secIncidents(s, userId);
    const now = Date.now();
    const triggered = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const cutoff = now - rule.windowMin * 60_000;
      const pat = rule.pattern.toLowerCase();
      const matches = events.filter((e) => {
        if (new Date(e.ts).getTime() < cutoff) return false;
        if (sevRankE(e.severity) < sevRankE(rule.minSeverity)) return false;
        const val = String(e[rule.field] ?? "").toLowerCase();
        return val.includes(pat);
      });
      if (matches.length < rule.threshold) continue;
      rule.lastFiredAt = new Date().toISOString();
      rule.fireCount += 1;
      const incident = {
        id: secId("inc"),
        title: `[Auto] ${rule.name}`,
        severity: rule.incidentSeverity,
        status: "detected",
        phase: "detected",
        origin: "alert-rule",
        ruleId: rule.id,
        eventIds: matches.map((m) => m.id),
        matchCount: matches.length,
        assignee: null,
        playbookId: null,
        playbookStepIndex: 0,
        notes: `Rule "${rule.name}" matched ${matches.length} event(s) in ${rule.windowMin}m window.`,
        timeline: [{ at: new Date().toISOString(), action: "detected", actor: "alert-engine", detail: `${matches.length} events` }],
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      incidents.push(incident);
      triggered.push({ ruleId: rule.id, ruleName: rule.name, incidentId: incident.id, matchCount: matches.length });
    }
    saveSecurity();
    return { ok: true, result: { triggered, rulesEvaluated: rules.filter((r) => r.enabled).length, incidentsCreated: triggered.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Incident response: list managed incidents ────────────────────
  registerLensAction("security", "incident-list", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let incidents = [...secIncidents(s, secActor(ctx))];
    if (params.status) incidents = incidents.filter((i) => i.status === params.status);
    if (params.open) incidents = incidents.filter((i) => i.status !== "closed");
    incidents.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return { ok: true, result: { incidents, count: incidents.length } };
  });

  // ── Incident response: create a managed incident manually ────────
  registerLensAction("security", "incident-open", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = secClean(params.title, 240);
    if (!title) return { ok: false, error: "incident title required" };
    const incident = {
      id: secId("inc"),
      title,
      severity: ["P1", "P2", "P3", "P4", "P5"].includes(params.severity) ? params.severity : "P3",
      status: "detected",
      phase: "detected",
      origin: "manual",
      ruleId: null,
      eventIds: Array.isArray(params.eventIds) ? params.eventIds.map(String).slice(0, 200) : [],
      matchCount: 0,
      assignee: secClean(params.assignee, 120) || null,
      playbookId: null,
      playbookStepIndex: 0,
      notes: secClean(params.notes, 2000) || "",
      timeline: [{ at: new Date().toISOString(), action: "opened", actor: secActor(ctx), detail: "manual" }],
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    secIncidents(s, secActor(ctx)).push(incident);
    saveSecurity();
    return { ok: true, result: { incident } };
  });

  // ── Incident response: built-in playbook library ─────────────────
  const PLAYBOOKS = {
    malware: { name: "Malware / Ransomware Response", steps: ["Isolate affected host from network", "Capture memory & disk image for forensics", "Identify malware family & IOCs", "Eradicate — remove persistence, clean systems", "Restore from known-good backup", "Document root cause & lessons learned"] },
    phishing: { name: "Phishing Response", steps: ["Quarantine the reported email org-wide", "Identify all recipients & click-throughs", "Reset credentials for compromised accounts", "Block sender domain & malicious URLs", "Notify affected users & run awareness reminder", "Close & record indicators"] },
    intrusion: { name: "Unauthorized Access / Intrusion", steps: ["Confirm the intrusion & scope affected assets", "Contain — revoke sessions, block source IPs", "Investigate lateral movement & data access", "Eradicate attacker foothold & patch entry vector", "Recover affected services & monitor", "Post-incident review"] },
    dos: { name: "DDoS / Availability Incident", steps: ["Confirm attack vs. legitimate traffic spike", "Enable upstream filtering / rate limiting", "Scale capacity & failover where possible", "Identify attack signature & block at edge", "Verify service recovery", "Capacity & resilience review"] },
    physical: { name: "Physical Security Breach", steps: ["Dispatch guard & verify the breach location", "Secure the area & account for personnel", "Review surveillance footage & access logs", "Identify how access was gained", "Remediate — repair, re-key, update badge access", "File report & update procedures"] },
  };

  registerLensAction("security", "playbook-list", (_ctx, _a, _params = {}) => {
    const playbooks = Object.entries(PLAYBOOKS).map(([id, p]) => ({ id, name: p.name, stepCount: p.steps.length, steps: p.steps }));
    return { ok: true, result: { playbooks, count: playbooks.length } };
  });

  // ── Incident response: attach a playbook to an incident ──────────
  registerLensAction("security", "incident-attach-playbook", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const incident = secIncidents(s, secActor(ctx)).find((i) => i.id === params.incidentId);
    if (!incident) return { ok: false, error: "incident not found" };
    const pb = PLAYBOOKS[params.playbookId];
    if (!pb) return { ok: false, error: "unknown playbook" };
    incident.playbookId = params.playbookId;
    incident.playbookSteps = pb.steps.map((text, idx) => ({ idx, text, done: false, doneAt: null }));
    incident.playbookStepIndex = 0;
    incident.timeline.push({ at: new Date().toISOString(), action: "playbook-attached", actor: secActor(ctx), detail: pb.name });
    saveSecurity();
    return { ok: true, result: { incident } };
  });

  // ── Incident response: advance workflow / complete a playbook step
  const IR_PHASES = ["detected", "triaged", "investigating", "contained", "eradicated", "recovered", "closed"];
  registerLensAction("security", "incident-advance", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const incident = secIncidents(s, secActor(ctx)).find((i) => i.id === params.incidentId);
    if (!incident) return { ok: false, error: "incident not found" };
    const updates = [];
    if (params.assignee != null) { incident.assignee = secClean(params.assignee, 120); updates.push("assigned"); }
    if (params.note) { incident.timeline.push({ at: new Date().toISOString(), action: "note", actor: secActor(ctx), detail: secClean(params.note, 600) }); updates.push("note"); }
    if (typeof params.completeStep === "number" && Array.isArray(incident.playbookSteps)) {
      const step = incident.playbookSteps[params.completeStep];
      if (step && !step.done) {
        step.done = true; step.doneAt = new Date().toISOString();
        incident.playbookStepIndex = incident.playbookSteps.filter((st) => st.done).length;
        incident.timeline.push({ at: new Date().toISOString(), action: "step-complete", actor: secActor(ctx), detail: step.text });
        updates.push("step");
      }
    }
    if (params.phase && IR_PHASES.includes(params.phase)) {
      incident.phase = params.phase;
      incident.status = params.phase === "closed" ? "closed" : params.phase === "detected" ? "detected" : params.phase;
      if (params.phase === "closed") incident.closedAt = new Date().toISOString();
      incident.timeline.push({ at: new Date().toISOString(), action: `phase:${params.phase}`, actor: secActor(ctx), detail: "" });
      updates.push("phase");
    }
    if (updates.length === 0) return { ok: false, error: "no valid update supplied" };
    saveSecurity();
    return { ok: true, result: { incident, updates } };
  });

  // ── CVE-to-asset matching: flag which registered assets a vuln hits
  registerLensAction("security", "cve-asset-match", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const assets = secAssets(s, userId);
    const vulns = secVulns(s, userId);
    const norm = (v) => String(v || "").toLowerCase().trim();
    const matches = [];
    const candidates = params.vulnId ? vulns.filter((v) => v.id === params.vulnId) : vulns;
    for (const v of candidates) {
      const hay = norm(`${v.title} ${v.cveId || ""} ${v.notes || ""}`);
      const hits = assets.filter((a) => {
        const vendor = norm(a.vendor), name = norm(a.name), ver = norm(a.version), type = norm(a.type);
        if (vendor && hay.includes(vendor)) return true;
        if (name && name.length >= 3 && hay.includes(name)) return true;
        if (type && type.length >= 3 && hay.includes(type)) return true;
        if (ver && ver.length >= 2 && hay.includes(ver)) return true;
        return false;
      });
      if (hits.length === 0) continue;
      // auto-link affected assets onto the vuln record
      const newIds = hits.map((a) => a.id);
      v.affectedAssetIds = [...new Set([...(v.affectedAssetIds || []), ...newIds])];
      matches.push({
        vulnId: v.id, cveId: v.cveId, title: v.title, severity: v.severity, cvss: v.cvss,
        affectedAssets: hits.map((a) => ({ id: a.id, name: a.name, vendor: a.vendor, version: a.version, critical: a.critical })),
      });
    }
    saveSecurity();
    return { ok: true, result: { matches, vulnsScanned: candidates.length, assetsRegistered: assets.length, totalMatches: matches.length } };
  });

  // ── Access-control / badge audit: record a badge access event ────
  registerLensAction("security", "badge-event-add", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const badgeId = secClean(params.badgeId, 64);
    const holder = secClean(params.holder, 120);
    const zone = secClean(params.zone, 120);
    if (!badgeId || !zone) return { ok: false, error: "badgeId and zone required" };
    const ev = {
      id: secId("bdg"),
      badgeId, holder: holder || null, zone,
      result: ["granted", "denied"].includes(params.result) ? params.result : "granted",
      ts: params.ts ? new Date(params.ts).toISOString() : new Date().toISOString(),
      door: secClean(params.door, 80) || null,
    };
    const arr = secBadgeEvents(s, secActor(ctx));
    arr.push(ev);
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    saveSecurity();
    return { ok: true, result: { event: ev } };
  });

  // ── Access-control / badge audit: surface anomalous access ───────
  registerLensAction("security", "badge-audit", (ctx, _a, params = {}) => {
  try {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const events = [...secBadgeEvents(s, secActor(ctx))].sort((a, b) => (a.ts > b.ts ? 1 : -1));
    const anomalies = [];
    const denials = events.filter((e) => e.result === "denied");
    // repeated denials per badge
    const denyByBadge = new Map();
    for (const d of denials) denyByBadge.set(d.badgeId, (denyByBadge.get(d.badgeId) || 0) + 1);
    for (const [badgeId, count] of denyByBadge) {
      if (count >= 3) anomalies.push({ kind: "repeated-denial", badgeId, count, detail: `${count} denied access attempts` });
    }
    // after-hours access (00:00–05:00 local)
    for (const e of events) {
      if (e.result !== "granted") continue;
      const hr = new Date(e.ts).getHours();
      if (hr >= 0 && hr < 5) anomalies.push({ kind: "after-hours", badgeId: e.badgeId, holder: e.holder, zone: e.zone, ts: e.ts, detail: `Access at ${String(hr).padStart(2, "0")}:00` });
    }
    // impossible travel — same badge in two zones within 60s
    const tailByBadge = new Map();
    for (const e of events) {
      const prev = tailByBadge.get(e.badgeId);
      if (prev && prev.zone !== e.zone) {
        const gapSec = (new Date(e.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
        if (gapSec >= 0 && gapSec < 60) anomalies.push({ kind: "rapid-zone-change", badgeId: e.badgeId, from: prev.zone, to: e.zone, gapSeconds: Math.round(gapSec), ts: e.ts, detail: `${prev.zone} → ${e.zone} in ${Math.round(gapSec)}s` });
      }
      tailByBadge.set(e.badgeId, e);
    }
    void params;
    return { ok: true, result: { anomalies, eventsAudited: events.length, denialCount: denials.length, anomalyCount: anomalies.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Surveillance camera tiles: register a camera ─────────────────
  registerLensAction("security", "camera-add", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = secClean(params.name, 120);
    if (!name) return { ok: false, error: "camera name required" };
    const camera = {
      id: secId("cam"),
      name,
      zone: secClean(params.zone, 120) || "unassigned",
      // streamUrl is user-supplied (their own camera/MJPEG endpoint) — never fabricated
      streamUrl: secClean(params.streamUrl, 600) || null,
      kind: ["indoor", "outdoor", "ptz", "thermal"].includes(params.kind) ? params.kind : "indoor",
      status: "online",
      motionDetection: params.motionDetection === true,
      lastMotionAt: null,
      createdAt: new Date().toISOString(),
    };
    secCameras(s, secActor(ctx)).push(camera);
    saveSecurity();
    return { ok: true, result: { camera } };
  });

  // ── Surveillance camera tiles: list tiles for the wall ───────────
  registerLensAction("security", "camera-list", (ctx, _a, _params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cameras = [...secCameras(s, secActor(ctx))];
    return { ok: true, result: { cameras, count: cameras.length, online: cameras.filter((c) => c.status === "online").length } };
  });

  registerLensAction("security", "camera-update", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cam = secCameras(s, secActor(ctx)).find((c) => c.id === params.id);
    if (!cam) return { ok: false, error: "camera not found" };
    if (params.status && ["online", "offline", "maintenance"].includes(params.status)) cam.status = params.status;
    if (params.streamUrl != null) cam.streamUrl = secClean(params.streamUrl, 600) || null;
    if (params.zone != null) cam.zone = secClean(params.zone, 120) || "unassigned";
    if (params.motionDetection != null) cam.motionDetection = params.motionDetection === true;
    if (params.recordMotion === true) cam.lastMotionAt = new Date().toISOString();
    saveSecurity();
    return { ok: true, result: { camera: cam } };
  });

  registerLensAction("security", "camera-delete", (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = secCameras(s, secActor(ctx));
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "camera not found" };
    arr.splice(i, 1);
    saveSecurity();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── EPSS exploit-probability + IOC threat-intel enrichment ───────
  //    EPSS: FIRST.org free public API. IOC reputation: derived locally
  //    from the live SIEM event stream (no key required).
  registerLensAction("security", "threat-enrich", async (ctx, _a, params = {}) => {
    const s = getSecState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const cveId = secClean(params.cveId, 30);
    const ioc = secClean(params.ioc, 256);
    if (!cveId && !ioc) return { ok: false, error: "cveId or ioc required" };
    const result = { cveId: cveId || null, ioc: ioc || null, enrichedAt: new Date().toISOString() };

    if (cveId) {
      try {
        const data = await fetchJsonWithTimeout(`https://api.first.org/data/v1/epss?cve=${encodeURIComponent(cveId)}`);
        const row = data?.data?.[0];
        if (row) {
          result.epss = {
            score: Number(row.epss),
            percentile: Number(row.percentile),
            date: row.date,
            exploitability: Number(row.epss) >= 0.5 ? "high" : Number(row.epss) >= 0.1 ? "moderate" : "low",
          };
        } else {
          result.epss = { score: null, note: "no EPSS data for this CVE" };
        }
      } catch (e) {
        result.epssError = `EPSS unreachable: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (ioc) {
      const events = secEvents(s, userId);
      const needle = ioc.toLowerCase();
      const sightings = events.filter((e) =>
        (e.srcIp || "").toLowerCase() === needle ||
        (e.host || "").toLowerCase().includes(needle) ||
        e.message.toLowerCase().includes(needle));
      const peak = sightings.reduce((m, e) => Math.max(m, sevRankE(e.severity)), 0);
      result.iocIntel = {
        value: ioc,
        sightings: sightings.length,
        peakSeverity: sightings.length ? EVENT_SEVERITY[peak] : null,
        firstSeen: sightings.length ? sightings.reduce((a, e) => (e.ts < a ? e.ts : a), sightings[0].ts) : null,
        lastSeen: sightings.length ? sightings.reduce((a, e) => (e.ts > a ? e.ts : a), sightings[0].ts) : null,
        reputation: sightings.length >= 5 || peak >= 3 ? "malicious" : sightings.length > 0 ? "suspicious" : "unknown",
      };
    }
    return { ok: true, result };
  });

  // accessAudit — deterministic security-posture audit over the user's assets +
  // vulnerabilities (real STATE, like security-dashboard). Surfaces the lens's
  // "Access Audit" button. Returns a posture score + open-critical list + advice.
  registerLensAction("security", "accessAudit", (ctx, _artifact, _params = {}) => {
  try {
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = secActor(ctx);
    const assets = secAssets(s, userId);
    const vulns = secVulns(s, userId);
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    let openCritical = 0;
    const critical = [];
    for (const v of vulns) {
      const sev = String(v?.severity || "low").toLowerCase();
      if (bySeverity[sev] !== undefined) bySeverity[sev] += 1;
      const open = v?.status !== "resolved" && v?.status !== "closed";
      if ((sev === "critical") && open) { openCritical += 1; critical.push({ cve: v.cve || null, title: v.title || "vulnerability", cvss: v.cvss ?? null }); }
    }
    // Posture score: start 100, subtract weighted open findings (capped at 0).
    const openHigh = vulns.filter(v => String(v?.severity).toLowerCase() === "high" && v?.status !== "resolved" && v?.status !== "closed").length;
    const postureScore = Math.max(0, 100 - openCritical * 20 - openHigh * 8 - bySeverity.medium * 2);
    const recommendations = [];
    if (openCritical > 0) recommendations.push(`Remediate ${openCritical} open critical vulnerability(ies) immediately.`);
    if (openHigh > 0) recommendations.push(`Schedule patching for ${openHigh} high-severity finding(s).`);
    if (assets.length === 0) recommendations.push("No assets inventoried — add assets to scope the attack surface.");
    if (recommendations.length === 0) recommendations.push("No open critical/high findings — maintain monitoring cadence.");
    return {
      ok: true,
      result: {
        assetCount: assets.length,
        vulnerabilityCount: vulns.length,
        vulnsBySeverity: bySeverity,
        openCritical,
        criticalFindings: critical.slice(0, 10),
        postureScore,
        rating: postureScore >= 90 ? "strong" : postureScore >= 70 ? "moderate" : postureScore >= 40 ? "weak" : "critical",
        recommendations,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
