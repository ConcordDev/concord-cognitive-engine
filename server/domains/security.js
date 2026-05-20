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
      const severity = t.severity || 3;
      const likelihood = t.probability || t.likelihood || 3;
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
    const incident = artifact.data || {};
    const severity = incident.severity || params.severity || 3;
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
  });

  registerLensAction("security", "threatAssessment", (ctx, artifact, _params) => {
    const threats = artifact.data?.threats || [artifact.data];
    const assessments = threats.map(t => {
      const probability = parseFloat(t.probability || t.likelihood) || 3;
      const impact = parseFloat(t.impact || t.severity) || 3;
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
  });

  registerLensAction("security", "vulnerabilityScan", (ctx, artifact, _params) => {
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
      return (sev[a.severity] || 4) - (sev[b.severity] || 4);
    });

    return {
      ok: true,
      result: {
        scannedAt: new Date().toISOString(),
        systemsScanned: systems.length,
        totalFindings: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        highCount: findings.filter(f => f.severity === 'high').length,
        mediumCount: findings.filter(f => f.severity === 'medium').length,
        findings,
      },
    };
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
    const s = getSecurityState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vuln = secVulns(s, secActor(ctx)).find((v) => v.id === params.id);
    if (!vuln) return { ok: false, error: "vulnerability not found" };
    if (params.status != null && VULN_STATUS.includes(params.status)) vuln.status = params.status;
    if (params.notes != null) vuln.notes = secClean(params.notes, 2000);
    if (params.cvss != null) { const c = secNum(params.cvss); if (c != null) { vuln.cvss = Math.max(0, Math.min(10, c)); vuln.severity = severityOf(vuln.cvss); } }
    if (Array.isArray(params.affectedAssetIds)) vuln.affectedAssetIds = params.affectedAssetIds.map(String).slice(0, 50);
    saveSecurity();
    return { ok: true, result: { vuln } };
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
};
