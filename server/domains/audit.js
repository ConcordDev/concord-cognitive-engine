// server/domains/audit.js
// Domain actions for auditing and compliance: compliance checks, trail analysis, risk scoring, sampling plans.

export default function registerAuditActions(registerLensAction) {
  /**
   * complianceCheck
   * Check data records against compliance rules — pattern matching, field validation,
   * cross-reference checks, gap detection.
   * artifact.data.records: [{ id, fields: { fieldName: value } }]
   * artifact.data.rules: [{ id, name, field, type: "required"|"pattern"|"range"|"crossRef"|"enum", pattern?, min?, max?, refField?, enumValues? }]
   */
  registerLensAction("audit", "complianceCheck", (ctx, artifact, params) => {
    const records = artifact.data.records || [];
    const rules = artifact.data.rules || [];

    if (records.length === 0) {
      return { ok: true, result: { message: "No records to check." } };
    }
    if (rules.length === 0) {
      return { ok: true, result: { message: "No compliance rules defined." } };
    }

    const violations = [];
    const recordResults = [];

    for (const record of records) {
      const fields = record.fields || {};
      const recordViolations = [];

      for (const rule of rules) {
        const value = fields[rule.field];
        let passed = true;
        let detail = "";

        switch (rule.type) {
          case "required":
            if (value === undefined || value === null || value === "") {
              passed = false;
              detail = `Field '${rule.field}' is required but missing or empty`;
            }
            break;

          case "pattern":
            if (value !== undefined && value !== null) {
              try {
                const regex = new RegExp(rule.pattern);
                if (!regex.test(String(value))) {
                  passed = false;
                  detail = `Field '${rule.field}' value '${value}' does not match pattern '${rule.pattern}'`;
                }
              } catch (e) {
                detail = `Invalid regex pattern: ${rule.pattern}`;
                passed = false;
              }
            }
            break;

          case "range":
            if (value !== undefined && value !== null) {
              const numVal = parseFloat(value);
              if (isNaN(numVal)) {
                passed = false;
                detail = `Field '${rule.field}' is not numeric`;
              } else {
                if (rule.min !== undefined && numVal < rule.min) {
                  passed = false;
                  detail = `Field '${rule.field}' value ${numVal} is below minimum ${rule.min}`;
                }
                if (rule.max !== undefined && numVal > rule.max) {
                  passed = false;
                  detail = `Field '${rule.field}' value ${numVal} exceeds maximum ${rule.max}`;
                }
              }
            }
            break;

          case "crossRef":
            if (value !== undefined && rule.refField) {
              const refValue = fields[rule.refField];
              if (refValue !== undefined && value !== refValue) {
                passed = false;
                detail = `Field '${rule.field}' (${value}) does not match reference field '${rule.refField}' (${refValue})`;
              }
            }
            break;

          case "enum":
            if (value !== undefined && value !== null && rule.enumValues) {
              if (!rule.enumValues.includes(value)) {
                passed = false;
                detail = `Field '${rule.field}' value '${value}' not in allowed values: ${rule.enumValues.join(", ")}`;
              }
            }
            break;
        }

        if (!passed) {
          const violation = {
            recordId: record.id,
            ruleId: rule.id,
            ruleName: rule.name,
            field: rule.field,
            value: value !== undefined ? value : null,
            detail,
          };
          violations.push(violation);
          recordViolations.push(violation);
        }
      }

      recordResults.push({
        recordId: record.id,
        totalRules: rules.length,
        passed: rules.length - recordViolations.length,
        failed: recordViolations.length,
        complianceRate: Math.round(((rules.length - recordViolations.length) / rules.length) * 10000) / 100,
        violations: recordViolations,
      });
    }

    // Gap detection: fields referenced in rules but never present in any record
    const ruleFields = new Set(rules.map(r => r.field));
    const presentFields = new Set();
    for (const record of records) {
      for (const key of Object.keys(record.fields || {})) {
        presentFields.add(key);
      }
    }
    const fieldGaps = [...ruleFields].filter(f => !presentFields.has(f));

    // Rule effectiveness: rules that never trigger violations may be redundant
    const ruleTriggerCounts = {};
    for (const rule of rules) ruleTriggerCounts[rule.id] = 0;
    for (const v of violations) ruleTriggerCounts[v.ruleId]++;

    const ruleEffectiveness = rules.map(r => ({
      ruleId: r.id,
      ruleName: r.name,
      violationCount: ruleTriggerCounts[r.id],
      triggerRate: Math.round((ruleTriggerCounts[r.id] / records.length) * 10000) / 100,
    }));

    const overallCompliance = records.length > 0
      ? Math.round(
          (recordResults.reduce((s, r) => s + r.complianceRate, 0) / records.length) * 100
        ) / 100
      : 100;

    // Rules that triggered ≥1 violation are the compliance "gaps" the card surfaces.
    // metRequirements = rules that never failed across the population.
    const triggeredRules = rules.filter(r => (ruleTriggerCounts[r.id] || 0) > 0);
    const metRequirements = rules.length - triggeredRules.length;
    const sevForCount = (count) => {
      const rate = records.length > 0 ? count / records.length : 0;
      return rate >= 0.5 ? "high" : rate >= 0.2 ? "medium" : "low";
    };
    const gaps = triggeredRules
      .map(r => {
        const count = ruleTriggerCounts[r.id] || 0;
        return {
          requirement: r.name || r.field || r.id,
          severity: sevForCount(count),
          remediation: `Resolve ${count} violation${count === 1 ? "" : "s"} of '${r.name || r.field || r.id}' across affected records.`,
          ruleId: r.id,
          violationCount: count,
        };
      })
      .sort((a, b) => b.violationCount - a.violationCount);

    const status = overallCompliance >= 95 ? "compliant"
      : overallCompliance >= 80 ? "partial"
      : "non-compliant";
    const framework = artifact.data.framework ? String(artifact.data.framework) : "Custom";

    const result = {
      analyzedAt: new Date().toISOString(),
      totalRecords: records.length,
      totalRules: rules.length,
      totalViolations: violations.length,
      overallComplianceRate: overallCompliance,
      fieldGaps,
      ruleEffectiveness,
      recordResults,
      violationsByRule: rules.map(r => ({
        ruleId: r.id,
        ruleName: r.name,
        count: ruleTriggerCounts[r.id],
      })).sort((a, b) => b.count - a.count),
      // ── Component-rendered card fields (AuditActionPanel.CompResult) ──
      // These are the EXACT names the result card reads; the originals above are
      // retained for the parity test + provenance. Aligned 2026-06-28.
      framework,
      complianceRate: overallCompliance,
      totalRequirements: rules.length,
      metRequirements,
      status,
      gaps,
    };

    artifact.data.complianceCheck = result;
    return { ok: true, result };
  });

  /**
   * trailAnalysis
   * Analyze audit trails for chain-of-custody integrity — detect gaps,
   * out-of-sequence entries, unauthorized modifications.
   * artifact.data.trail: [{ sequenceNumber, timestamp, actor, action, objectId, hash?, previousHash? }]
   * params.expectedActors — list of authorized actors (optional)
   */
  registerLensAction("audit", "trailAnalysis", (ctx, artifact, params) => {
  try {
    const trail = artifact.data.trail || [];
    if (trail.length === 0) {
      return { ok: true, result: { message: "No audit trail entries provided." } };
    }

    const expectedActors = params.expectedActors ? new Set(params.expectedActors) : null;

    // Sort by sequence number
    const sorted = [...trail].sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));

    const issues = [];

    // 1. Sequence gap detection
    for (let i = 1; i < sorted.length; i++) {
      const expected = sorted[i - 1].sequenceNumber + 1;
      const actual = sorted[i].sequenceNumber;
      if (actual !== expected) {
        issues.push({
          type: "sequence-gap",
          severity: "high",
          detail: `Gap between sequence ${sorted[i - 1].sequenceNumber} and ${actual} (expected ${expected})`,
          missingCount: actual - expected,
          afterEntry: sorted[i - 1].sequenceNumber,
          beforeEntry: actual,
        });
      }
    }

    // 2. Timestamp ordering: entries should have monotonically increasing timestamps
    for (let i = 1; i < sorted.length; i++) {
      const prevTs = new Date(sorted[i - 1].timestamp).getTime();
      const currTs = new Date(sorted[i].timestamp).getTime();
      if (!isNaN(prevTs) && !isNaN(currTs) && currTs < prevTs) {
        issues.push({
          type: "out-of-sequence-timestamp",
          severity: "high",
          detail: `Entry ${sorted[i].sequenceNumber} timestamp (${sorted[i].timestamp}) is before entry ${sorted[i - 1].sequenceNumber} (${sorted[i - 1].timestamp})`,
          sequenceNumber: sorted[i].sequenceNumber,
          timeDifferenceMs: prevTs - currTs,
        });
      }
    }

    // 3. Hash chain integrity
    let hashChainValid = true;
    const hashIssues = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].previousHash && sorted[i - 1].hash) {
        if (sorted[i].previousHash !== sorted[i - 1].hash) {
          hashChainValid = false;
          hashIssues.push({
            type: "hash-chain-break",
            severity: "critical",
            detail: `Entry ${sorted[i].sequenceNumber} previousHash does not match entry ${sorted[i - 1].sequenceNumber} hash`,
            sequenceNumber: sorted[i].sequenceNumber,
            expectedHash: sorted[i - 1].hash,
            actualPreviousHash: sorted[i].previousHash,
          });
        }
      }
    }
    issues.push(...hashIssues);

    // 4. Unauthorized actor detection
    const unauthorizedActions = [];
    if (expectedActors) {
      for (const entry of sorted) {
        if (!expectedActors.has(entry.actor)) {
          unauthorizedActions.push({
            type: "unauthorized-actor",
            severity: "critical",
            sequenceNumber: entry.sequenceNumber,
            actor: entry.actor,
            action: entry.action,
            objectId: entry.objectId,
            timestamp: entry.timestamp,
          });
        }
      }
      issues.push(...unauthorizedActions);
    }

    // 5. Duplicate sequence numbers
    const seqCounts = {};
    for (const entry of sorted) {
      seqCounts[entry.sequenceNumber] = (seqCounts[entry.sequenceNumber] || 0) + 1;
    }
    for (const [seq, count] of Object.entries(seqCounts)) {
      if (count > 1) {
        issues.push({
          type: "duplicate-sequence",
          severity: "high",
          detail: `Sequence number ${seq} appears ${count} times`,
          sequenceNumber: parseInt(seq),
          count,
        });
      }
    }

    // 6. Time gap analysis: unusually long gaps may indicate missing entries
    const timeGaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevTs = new Date(sorted[i - 1].timestamp).getTime();
      const currTs = new Date(sorted[i].timestamp).getTime();
      if (!isNaN(prevTs) && !isNaN(currTs)) {
        timeGaps.push(currTs - prevTs);
      }
    }

    const avgGap = timeGaps.length > 0 ? timeGaps.reduce((s, g) => s + g, 0) / timeGaps.length : 0;
    const gapStdDev = timeGaps.length > 1
      ? Math.sqrt(timeGaps.reduce((s, g) => s + Math.pow(g - avgGap, 2), 0) / timeGaps.length)
      : 0;

    for (let i = 0; i < timeGaps.length; i++) {
      if (gapStdDev > 0 && (timeGaps[i] - avgGap) / gapStdDev > 3) {
        issues.push({
          type: "suspicious-time-gap",
          severity: "medium",
          detail: `Unusually long gap of ${Math.round(timeGaps[i] / 1000)}s between entries ${sorted[i].sequenceNumber} and ${sorted[i + 1].sequenceNumber}`,
          gapMs: timeGaps[i],
          zScore: Math.round(((timeGaps[i] - avgGap) / gapStdDev) * 100) / 100,
        });
      }
    }

    // Actor summary
    const actorSummary = {};
    for (const entry of sorted) {
      if (!actorSummary[entry.actor]) {
        actorSummary[entry.actor] = { actionCount: 0, actions: {}, firstSeen: entry.timestamp, lastSeen: entry.timestamp };
      }
      actorSummary[entry.actor].actionCount++;
      actorSummary[entry.actor].actions[entry.action] = (actorSummary[entry.actor].actions[entry.action] || 0) + 1;
      actorSummary[entry.actor].lastSeen = entry.timestamp;
    }

    // Integrity score: 100 minus deductions
    let integrityScore = 100;
    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const highCount = issues.filter(i => i.severity === "high").length;
    const mediumCount = issues.filter(i => i.severity === "medium").length;
    integrityScore -= criticalCount * 20;
    integrityScore -= highCount * 10;
    integrityScore -= mediumCount * 3;
    integrityScore = Math.max(0, integrityScore);

    // ── Component-rendered card fields (AuditActionPanel.TrailResult) ──
    // anomalies = each detected issue flattened to { event, user, reason } the
    // card maps; the originating actor is resolved from the issue's sequence
    // number when the issue itself carries no actor.
    const seqToActor = {};
    for (const entry of sorted) seqToActor[entry.sequenceNumber] = entry.actor;
    const anomalies = issues.map(i => ({
      event: i.type,
      user: i.actor || (i.sequenceNumber !== undefined ? seqToActor[i.sequenceNumber] : undefined) || "—",
      reason: i.detail || `${i.severity} severity ${i.type}`,
      severity: i.severity,
    }));
    const userActivitySummary = Object.entries(actorSummary)
      .map(([user, s]) => ({ user, eventCount: s.actionCount }))
      .sort((a, b) => b.eventCount - a.eventCount);
    // Human-readable rollups for the "↗" suspicious-pattern lines.
    const suspiciousPatterns = [];
    if (highCount > 0) suspiciousPatterns.push(`${highCount} high-severity sequence/timestamp anomal${highCount === 1 ? "y" : "ies"}`);
    if (criticalCount > 0) suspiciousPatterns.push(`${criticalCount} critical integrity break${criticalCount === 1 ? "" : "s"} (hash chain / unauthorized actor)`);
    if (!hashChainValid) suspiciousPatterns.push("Hash chain broken — possible tampering");

    const result = {
      analyzedAt: new Date().toISOString(),
      totalEntries: trail.length,
      sequenceRange: sorted.length > 0
        ? { first: sorted[0].sequenceNumber, last: sorted[sorted.length - 1].sequenceNumber }
        : null,
      integrityScore,
      hashChainValid: hashIssues.length === 0,
      issues,
      issueSummary: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        total: issues.length,
      },
      actorSummary,
      timeAnalysis: {
        avgGapMs: Math.round(avgGap),
        gapStdDevMs: Math.round(gapStdDev),
      },
      // EXACT card fields (TrailResult). Aligned 2026-06-28.
      totalEvents: trail.length,
      anomalies,
      userActivitySummary,
      suspiciousPatterns,
    };

    artifact.data.trailAnalysis = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * riskScore
   * Compute audit risk using control effectiveness, inherent risk, and detection risk —
   * multiplicative risk model with Bayesian adjustment.
   * artifact.data.controls: [{ id, name, effectiveness: 0-1, testResults?: [{ passed: boolean }] }]
   * artifact.data.inherentRisks: [{ id, name, likelihood: 0-1, impact: 0-1, category? }]
   * params.priorRiskLevel — Bayesian prior for overall risk (default 0.5)
   */
  registerLensAction("audit", "riskScore", (ctx, artifact, params) => {
  try {
    const controls = artifact.data.controls || [];
    const inherentRisks = artifact.data.inherentRisks || [];
    // Fail-CLOSED probability coercion: Number()+Number.isFinite, then clamp to
    // [0,1]. parseFloat accepts "Infinity" (→ Infinity, leaks NaN downstream) and
    // a "12abc" prefix; this rejects both to 0. A finite out-of-range value is
    // clamped so likelihood*impact and 1−effectiveness stay in [0,1].
    const prob = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
    const priorRiskLevel = prob(params.priorRiskLevel ?? 0.5);

    // Evaluate control effectiveness from test results if available
    const controlResults = controls.map(ctrl => {
      let effectiveness = prob(ctrl.effectiveness);

      if (ctrl.testResults && ctrl.testResults.length > 0) {
        const passRate = ctrl.testResults.filter(t => t.passed).length / ctrl.testResults.length;
        // Bayesian update: combine stated effectiveness with observed pass rate
        effectiveness = (effectiveness + passRate) / 2;
      }

      const controlRisk = 1 - effectiveness; // Risk that control fails
      return {
        id: ctrl.id,
        name: ctrl.name,
        statedEffectiveness: prob(ctrl.effectiveness),
        observedEffectiveness: ctrl.testResults
          ? Math.round((ctrl.testResults.filter(t => t.passed).length / ctrl.testResults.length) * 10000) / 10000
          : null,
        adjustedEffectiveness: Math.round(effectiveness * 10000) / 10000,
        controlRisk: Math.round(controlRisk * 10000) / 10000,
        testCount: ctrl.testResults ? ctrl.testResults.length : 0,
      };
    });

    // Overall control risk: probability that at least one control fails
    // P(any fail) = 1 - product(effectiveness_i) for independent controls
    const controlProduct = controlResults.reduce((p, c) => p * c.adjustedEffectiveness, 1);
    const overallControlRisk = Math.round((1 - controlProduct) * 10000) / 10000;

    // Detection risk: complement of control effectiveness
    const detectionRisk = controls.length > 0
      ? Math.round((1 - controlResults.reduce((s, c) => s + c.adjustedEffectiveness, 0) / controlResults.length) * 10000) / 10000
      : 0.5;

    // Inherent risk assessment
    const riskAssessments = inherentRisks.map(risk => {
      const likelihood = prob(risk.likelihood);
      const impact = prob(risk.impact);
      // Risk score = likelihood * impact
      const riskScore = Math.round(likelihood * impact * 10000) / 10000;
      // Expected loss index
      const expectedLoss = Math.round(riskScore * 100) / 100;

      return {
        id: risk.id,
        name: risk.name,
        category: risk.category || "uncategorized",
        likelihood,
        impact,
        riskScore,
        expectedLoss,
        level: riskScore >= 0.6 ? "high" : riskScore >= 0.3 ? "medium" : "low",
      };
    });

    // Overall inherent risk: weighted average
    const avgInherentRisk = riskAssessments.length > 0
      ? riskAssessments.reduce((s, r) => s + r.riskScore, 0) / riskAssessments.length
      : 0.5;

    // Audit risk model: AR = IR * CR * DR
    // IR = inherent risk, CR = control risk, DR = detection risk
    const auditRisk = Math.round(avgInherentRisk * overallControlRisk * detectionRisk * 10000) / 10000;

    // Bayesian adjustment: update with prior
    // P(risk | evidence) = P(evidence | risk) * P(risk) / P(evidence)
    // Simplified: weighted combination of prior and computed risk
    const evidenceWeight = Math.min(1, (controls.length + inherentRisks.length) / 10);
    const bayesianRisk = Math.round(
      (auditRisk * evidenceWeight + priorRiskLevel * (1 - evidenceWeight)) * 10000
    ) / 10000;

    // Risk by category
    const categoryRisks = {};
    for (const r of riskAssessments) {
      if (!categoryRisks[r.category]) categoryRisks[r.category] = { risks: [], avgScore: 0 };
      categoryRisks[r.category].risks.push(r);
    }
    for (const cat of Object.keys(categoryRisks)) {
      const risks = categoryRisks[cat].risks;
      categoryRisks[cat].avgScore = Math.round(
        (risks.reduce((s, r) => s + r.riskScore, 0) / risks.length) * 10000
      ) / 10000;
    }

    const riskLevel = bayesianRisk >= 0.6 ? "high"
      : bayesianRisk >= 0.3 ? "medium"
      : "low";

    const inherentRiskRounded = Math.round(avgInherentRisk * 10000) / 10000;

    const result = {
      analyzedAt: new Date().toISOString(),
      auditRisk,
      bayesianAdjustedRisk: bayesianRisk,
      riskLevel,
      components: {
        inherentRisk: inherentRiskRounded,
        controlRisk: overallControlRisk,
        detectionRisk,
      },
      priorRiskLevel,
      evidenceWeight: Math.round(evidenceWeight * 10000) / 10000,
      controlResults,
      riskAssessments: riskAssessments.sort((a, b) => b.riskScore - a.riskScore),
      categoryRisks,
      // ── Component-rendered card fields (AuditActionPanel.RiskResult) ──
      // The card reads flat controls/overallControlRisk/detectionRisk/inherentRisk
      // (not the nested `components`). controlResults already carries the exact
      // RiskControlRow shape {id,name,adjustedEffectiveness,controlRisk,
      // observedEffectiveness}. Aligned 2026-06-28.
      controls: controlResults,
      overallControlRisk,
      detectionRisk,
      inherentRisk: inherentRiskRounded,
    };

    artifact.data.riskScore = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * samplingPlan
   * Design statistical sampling plan — compute sample sizes for given confidence
   * levels, stratified sampling allocation.
   * artifact.data.population: { total: number, strata?: [{ name, size, riskLevel? }] }
   * params.confidenceLevel — desired confidence level (default 0.95)
   * params.marginOfError — acceptable margin of error (default 0.05)
   * params.expectedDefectRate — expected defect/error rate (default 0.05)
   */
  registerLensAction("audit", "samplingPlan", (ctx, artifact, params) => {
  try {
    const d = artifact.data || {};
    const population = d.population || {};

    // Fail-CLOSED numeric coercion: Number()+Number.isFinite, NOT parseFloat
    // (so "12abc"/"Infinity"/"NaN" fall to the supplied default, never leak).
    const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
    // Flat component keys (tolerableErrorRate/expectedErrorRate, and
    // confidenceLevel sent alongside the flat populationSize) are ALWAYS percents
    // (0–100) from the lens's "Conf %"/"Tol %" text inputs → divide by 100.
    const asPercent = (v, dflt) => { const n = num(v, NaN); return Number.isFinite(n) && n > 0 ? n / 100 : dflt; };
    // params/parity keys (marginOfError/expectedDefectRate, and a params-supplied
    // confidenceLevel) are ALWAYS fractions (0–1).
    const asFractionStrict = (v, dflt) => { const n = num(v, NaN); return Number.isFinite(n) && n > 0 ? n : dflt; };

    // Population: flat `populationSize` (component) OR `population.total` (parity).
    const total = num(d.populationSize, num(population.total, 0));

    if (!(total > 0)) {
      return { ok: true, result: { message: "Population size must be positive." } };
    }

    // Disambiguate by which key arrived: a flat component percent vs a params
    // fraction. The component path uses confidenceLevel/tolerableErrorRate/
    // expectedErrorRate (percents); the parity path uses params.confidenceLevel/
    // marginOfError/expectedDefectRate (fractions). Component wins when present.
    const confidenceLevel = d.confidenceLevel !== undefined
      ? asPercent(d.confidenceLevel, 0.95)
      : asFractionStrict(params.confidenceLevel, 0.95);
    const marginOfError = d.tolerableErrorRate !== undefined
      ? asPercent(d.tolerableErrorRate, 0.05)
      : asFractionStrict(d.marginOfError ?? params.marginOfError, 0.05);
    const expectedDefectRate = d.expectedErrorRate !== undefined
      ? asPercent(d.expectedErrorRate, 0.05)
      : asFractionStrict(d.expectedDefectRate ?? params.expectedDefectRate, 0.05);

    // Z-score lookup for common confidence levels
    function zScore(confidence) {
      if (confidence >= 0.99) return 2.576;
      if (confidence >= 0.975) return 2.241;
      if (confidence >= 0.95) return 1.96;
      if (confidence >= 0.9) return 1.645;
      if (confidence >= 0.85) return 1.44;
      if (confidence >= 0.8) return 1.282;
      // Approximation for other values using inverse normal
      // Rational approximation (Abramowitz & Stegun)
      const p = (1 + confidence) / 2;
      const t = Math.sqrt(-2 * Math.log(1 - p));
      return Math.round((t - (2.515517 + 0.802853 * t + 0.010328 * t * t) /
        (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t)) * 10000) / 10000;
    }

    const z = zScore(confidenceLevel);
    const p = expectedDefectRate;
    const q = 1 - p;

    // Sample size formula: n = (Z^2 * p * q / E^2) / (1 + (Z^2 * p * q / (E^2 * N)))
    // This is the finite population correction
    const infiniteSampleSize = (z * z * p * q) / (marginOfError * marginOfError);
    const finiteSampleSize = Math.ceil(infiniteSampleSize / (1 + (infiniteSampleSize - 1) / total));

    // Multiple confidence level comparisons
    const comparisonLevels = [0.80, 0.85, 0.90, 0.95, 0.99];
    const sampleSizeComparison = comparisonLevels.map(cl => {
      const zc = zScore(cl);
      const infN = (zc * zc * p * q) / (marginOfError * marginOfError);
      const finN = Math.ceil(infN / (1 + (infN - 1) / total));
      return {
        confidenceLevel: cl,
        confidencePct: Math.round(cl * 100),
        sampleSize: finN,
        samplingFraction: Math.round((finN / total) * 10000) / 100,
      };
    });

    // Stratified sampling allocation
    const strata = population.strata || [];
    let stratifiedPlan = null;

    if (strata.length > 0) {
      const totalStratumSize = strata.reduce((s, st) => s + (st.size || 0), 0);

      // Risk-weighted allocation: higher risk strata get more samples
      const riskWeights = { high: 3, medium: 2, low: 1 };

      const totalRiskWeight = strata.reduce((s, st) => {
        const weight = riskWeights[st.riskLevel] || 1;
        return s + (st.size || 0) * weight;
      }, 0);

      // Proportional allocation
      const proportionalAllocation = strata.map(st => {
        const proportion = totalStratumSize > 0 ? (st.size || 0) / totalStratumSize : 0;
        return {
          stratum: st.name,
          size: st.size || 0,
          proportionalSample: Math.ceil(finiteSampleSize * proportion),
          proportion: Math.round(proportion * 10000) / 100,
        };
      });

      // Risk-weighted (Neyman-like) allocation
      const riskWeightedAllocation = strata.map(st => {
        const weight = riskWeights[st.riskLevel] || 1;
        const riskProportion = totalRiskWeight > 0 ? ((st.size || 0) * weight) / totalRiskWeight : 0;
        const allocated = Math.ceil(finiteSampleSize * riskProportion);
        // Cap at stratum size
        const sample = Math.min(allocated, st.size || 0);
        return {
          stratum: st.name,
          size: st.size || 0,
          riskLevel: st.riskLevel || "medium",
          riskWeight: weight,
          allocatedSample: sample,
          proportion: Math.round(riskProportion * 10000) / 100,
          samplingRate: st.size > 0 ? Math.round((sample / st.size) * 10000) / 100 : 0,
        };
      });

      stratifiedPlan = {
        totalStrata: strata.length,
        proportionalAllocation,
        riskWeightedAllocation,
        totalProportionalSamples: proportionalAllocation.reduce((s, a) => s + a.proportionalSample, 0),
        totalRiskWeightedSamples: riskWeightedAllocation.reduce((s, a) => s + a.allocatedSample, 0),
      };
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      populationSize: total,
      parameters: {
        confidenceLevel,
        confidencePct: Math.round(confidenceLevel * 100),
        marginOfError,
        marginOfErrorPct: Math.round(marginOfError * 100),
        expectedDefectRate,
        zScore: z,
      },
      requiredSampleSize: finiteSampleSize,
      samplingFraction: Math.round((finiteSampleSize / total) * 10000) / 100,
      infinitePopulationSampleSize: Math.ceil(infiniteSampleSize),
      finitePopulationCorrection: Math.round((finiteSampleSize / infiniteSampleSize) * 10000) / 10000,
      comparisonByConfidence: sampleSizeComparison,
      stratifiedPlan,
      // ── Component-rendered card fields (AuditActionPanel.SamplingResult) ──
      // The card reads sampleSize / populationSize / confidenceLevel (as a PERCENT
      // for the "{confidenceLevel}% confidence" line) / expectedErrorRate / method
      // / rationale. Aligned 2026-06-28.
      sampleSize: finiteSampleSize,
      confidenceLevel: Math.round(confidenceLevel * 100),
      expectedErrorRate: Math.round(expectedDefectRate * 10000) / 100,
      method: strata.length > 0 ? "stratified" : "attribute (finite-population)",
      rationale: `n=${finiteSampleSize} of ${total} at ${Math.round(confidenceLevel * 100)}% confidence, ±${Math.round(marginOfError * 100)}% margin, ${Math.round(expectedDefectRate * 10000) / 100}% expected error rate (Z=${z}).`,
    };

    artifact.data.samplingPlan = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─────────────────────────────────────────────────────────────
  // Compliance-automation core (parity sprint vs Vanta / Drata)
  // Persistent per-user state in globalThis._concordSTATE.
  // ─────────────────────────────────────────────────────────────

  function getAuditState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.auditLens) STATE.auditLens = {};
    const s = STATE.auditLens;
    for (const k of [
      "controls", "evidence", "findings", "policies",
      "policyAcceptance", "vendors", "monitors",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveAuditState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function actorId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }

  // Built-in control frameworks: SOC 2 Trust Service Criteria + ISO 27001 Annex A (abridged but real catalog entries).
  const FRAMEWORKS = {
    "soc2": {
      name: "SOC 2 (Trust Services Criteria)",
      controls: [
        { ref: "CC1.1", category: "Control Environment", title: "Commitment to integrity and ethical values" },
        { ref: "CC2.1", category: "Communication & Information", title: "Internal communication of objectives and responsibilities" },
        { ref: "CC3.2", category: "Risk Assessment", title: "Identification and analysis of risks to objectives" },
        { ref: "CC5.2", category: "Control Activities", title: "Control activities deployed through policies and procedures" },
        { ref: "CC6.1", category: "Logical Access", title: "Logical access security software and infrastructure" },
        { ref: "CC6.2", category: "Logical Access", title: "User registration and de-registration" },
        { ref: "CC6.3", category: "Logical Access", title: "Role-based access and least privilege" },
        { ref: "CC7.2", category: "System Operations", title: "Monitoring of system components for anomalies" },
        { ref: "CC7.3", category: "System Operations", title: "Evaluation of security events" },
        { ref: "CC8.1", category: "Change Management", title: "Changes to infrastructure and software authorized" },
        { ref: "A1.2", category: "Availability", title: "Environmental protections, backup and recovery" },
        { ref: "C1.1", category: "Confidentiality", title: "Confidential information identified and protected" },
      ],
    },
    "iso27001": {
      name: "ISO/IEC 27001:2022 (Annex A)",
      controls: [
        { ref: "A.5.1", category: "Organizational", title: "Policies for information security" },
        { ref: "A.5.15", category: "Organizational", title: "Access control" },
        { ref: "A.5.23", category: "Organizational", title: "Information security for use of cloud services" },
        { ref: "A.6.3", category: "People", title: "Information security awareness, education and training" },
        { ref: "A.8.1", category: "Technological", title: "User endpoint devices" },
        { ref: "A.8.5", category: "Technological", title: "Secure authentication" },
        { ref: "A.8.8", category: "Technological", title: "Management of technical vulnerabilities" },
        { ref: "A.8.15", category: "Technological", title: "Logging" },
        { ref: "A.8.16", category: "Technological", title: "Monitoring activities" },
        { ref: "A.8.24", category: "Technological", title: "Use of cryptography" },
        { ref: "A.5.30", category: "Organizational", title: "ICT readiness for business continuity" },
        { ref: "A.7.4", category: "Physical", title: "Physical security monitoring" },
      ],
    },
  };

  // ── Feature 1: Control framework mapping (SOC 2 / ISO 27001) ──

  registerLensAction("audit", "frameworkCatalog", (_ctx, _artifact, _params = {}) => {
    return {
      ok: true,
      result: {
        frameworks: Object.entries(FRAMEWORKS).map(([id, f]) => ({
          id, name: f.name, controlCount: f.controls.length,
        })),
      },
    };
  });

  registerLensAction("audit", "frameworkAdopt", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const fwId = String(params.framework || "").trim();
    const fw = FRAMEWORKS[fwId];
    if (!fw) return { ok: false, error: `Unknown framework: ${fwId}` };
    const userId = actorId(ctx);
    if (!state.controls.has(userId)) state.controls.set(userId, []);
    const list = state.controls.get(userId);
    const existing = new Set(list.filter(c => c.framework === fwId).map(c => c.ref));
    let added = 0;
    for (const c of fw.controls) {
      if (existing.has(c.ref)) continue;
      list.push({
        id: uid("ctl"),
        framework: fwId,
        ref: c.ref,
        category: c.category,
        title: c.title,
        status: "not_assessed", // not_assessed | pass | fail | not_applicable
        owner: null,
        notes: "",
        lastAssessedAt: null,
        createdAt: new Date().toISOString(),
      });
      added++;
    }
    saveAuditState();
    return { ok: true, result: { framework: fwId, name: fw.name, added, totalControls: list.filter(c => c.framework === fwId).length } };
  });

  registerLensAction("audit", "controlList", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    let list = state.controls.get(userId) || [];
    if (params.framework) list = list.filter(c => c.framework === params.framework);
    const evidence = state.evidence.get(userId) || [];
    const findings = state.findings.get(userId) || [];
    const enriched = list.map(c => ({
      ...c,
      evidenceCount: evidence.filter(e => e.controlId === c.id).length,
      openFindings: findings.filter(f => f.controlId === c.id && f.status !== "closed").length,
    }));
    const byStatus = { pass: 0, fail: 0, not_assessed: 0, not_applicable: 0 };
    for (const c of enriched) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    const assessable = byStatus.pass + byStatus.fail;
    const complianceRate = assessable > 0 ? Math.round((byStatus.pass / assessable) * 1000) / 10 : 0;
    return {
      ok: true,
      result: { controls: enriched, summary: { ...byStatus, total: enriched.length, complianceRate } },
    };
  });

  registerLensAction("audit", "controlUpdate", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const list = state.controls.get(userId) || [];
    const ctl = list.find(c => c.id === params.id);
    if (!ctl) return { ok: false, error: "Control not found" };
    const validStatus = ["not_assessed", "pass", "fail", "not_applicable"];
    if (params.status !== undefined) {
      if (!validStatus.includes(params.status)) return { ok: false, error: "Invalid status" };
      ctl.status = params.status;
      ctl.lastAssessedAt = new Date().toISOString();
    }
    if (params.owner !== undefined) ctl.owner = params.owner ? String(params.owner) : null;
    if (params.notes !== undefined) ctl.notes = String(params.notes);
    saveAuditState();
    return { ok: true, result: { control: ctl } };
  });

  // ── Feature 2: Evidence collection + attachment per control ──

  registerLensAction("audit", "evidenceAdd", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const controlId = String(params.controlId || "").trim();
    const title = String(params.title || "").trim();
    if (!controlId) return { ok: false, error: "controlId required" };
    if (!title) return { ok: false, error: "title required" };
    const controls = state.controls.get(userId) || [];
    if (!controls.find(c => c.id === controlId)) return { ok: false, error: "Control not found" };
    if (!state.evidence.has(userId)) state.evidence.set(userId, []);
    const validKinds = ["document", "screenshot", "log", "config", "url", "attestation"];
    const ev = {
      id: uid("evd"),
      controlId,
      title,
      kind: validKinds.includes(params.kind) ? params.kind : "document",
      reference: String(params.reference || ""),
      content: String(params.content || ""),
      collectedBy: userId,
      collectedAt: new Date().toISOString(),
      expiresAt: params.expiresAt ? String(params.expiresAt) : null,
    };
    state.evidence.get(userId).push(ev);
    saveAuditState();
    return { ok: true, result: { evidence: ev } };
  });

  registerLensAction("audit", "evidenceList", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    let list = state.evidence.get(userId) || [];
    if (params.controlId) list = list.filter(e => e.controlId === params.controlId);
    const now = Date.now();
    const enriched = list.map(e => ({
      ...e,
      expired: e.expiresAt ? new Date(e.expiresAt).getTime() < now : false,
    }));
    return {
      ok: true,
      result: {
        evidence: enriched,
        total: enriched.length,
        expiredCount: enriched.filter(e => e.expired).length,
      },
    };
  });

  registerLensAction("audit", "evidenceDelete", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const list = state.evidence.get(userId) || [];
    const idx = list.findIndex(e => e.id === params.id);
    if (idx === -1) return { ok: false, error: "Evidence not found" };
    list.splice(idx, 1);
    saveAuditState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 3: Continuous monitoring with automated control tests ──

  // Registered automated test checks; each evaluates a deterministic predicate.
  const MONITOR_CHECKS = {
    "mfa_enforced": { title: "Multi-factor auth enforced", maps: ["CC6.1", "A.8.5"] },
    "access_reviews": { title: "Quarterly access reviews completed", maps: ["CC6.2", "A.5.15"] },
    "encryption_at_rest": { title: "Data encrypted at rest", maps: ["C1.1", "A.8.24"] },
    "backup_verified": { title: "Backups verified within 7 days", maps: ["A1.2", "A.5.30"] },
    "vuln_scan_recent": { title: "Vulnerability scan within 30 days", maps: ["CC7.2", "A.8.8"] },
    "audit_logging": { title: "Audit logging enabled on critical systems", maps: ["CC7.3", "A.8.15"] },
    "change_approval": { title: "Changes require documented approval", maps: ["CC8.1", "A.5.1"] },
  };

  registerLensAction("audit", "monitorList", (ctx, _artifact, _params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const configured = state.monitors.get(userId) || {};
    const checks = Object.entries(MONITOR_CHECKS).map(([id, c]) => ({
      id,
      title: c.title,
      mapsTo: c.maps,
      ...(configured[id] || { enabled: false, lastRun: null, lastResult: null }),
    }));
    return { ok: true, result: { checks } };
  });

  registerLensAction("audit", "monitorConfigure", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const checkId = String(params.checkId || "");
    if (!MONITOR_CHECKS[checkId]) return { ok: false, error: "Unknown check" };
    const configured = state.monitors.get(userId) || {};
    configured[checkId] = {
      ...(configured[checkId] || { lastRun: null, lastResult: null }),
      enabled: !!params.enabled,
      // Operator-supplied facts the check evaluates against.
      facts: params.facts && typeof params.facts === "object" ? params.facts : (configured[checkId]?.facts || {}),
    };
    state.monitors.set(userId, configured);
    saveAuditState();
    return { ok: true, result: { checkId, config: configured[checkId] } };
  });

  registerLensAction("audit", "monitorRun", (ctx, _artifact, _params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const configured = state.monitors.get(userId) || {};
    const controls = state.controls.get(userId) || [];
    const now = new Date().toISOString();
    const results = [];
    let autoUpdatedControls = 0;
    for (const [id, meta] of Object.entries(MONITOR_CHECKS)) {
      const cfg = configured[id];
      if (!cfg || !cfg.enabled) continue;
      const facts = cfg.facts || {};
      // Deterministic predicate per check, evaluated against operator facts.
      let passed = false;
      let reason = "";
      switch (id) {
        case "mfa_enforced":
          passed = facts.mfaUsers !== undefined && facts.totalUsers !== undefined &&
            facts.totalUsers > 0 && facts.mfaUsers >= facts.totalUsers;
          reason = `${facts.mfaUsers ?? 0}/${facts.totalUsers ?? 0} users enrolled in MFA`;
          break;
        case "access_reviews": {
          const days = facts.lastReviewDaysAgo;
          passed = days !== undefined && days <= 90;
          reason = days !== undefined ? `Last review ${days} days ago` : "No review date recorded";
          break;
        }
        case "encryption_at_rest":
          passed = facts.encryptedVolumes !== undefined && facts.totalVolumes !== undefined &&
            facts.totalVolumes > 0 && facts.encryptedVolumes >= facts.totalVolumes;
          reason = `${facts.encryptedVolumes ?? 0}/${facts.totalVolumes ?? 0} volumes encrypted`;
          break;
        case "backup_verified": {
          const d = facts.lastBackupDaysAgo;
          passed = d !== undefined && d <= 7;
          reason = d !== undefined ? `Last verified backup ${d} days ago` : "No backup date recorded";
          break;
        }
        case "vuln_scan_recent": {
          const d = facts.lastScanDaysAgo;
          passed = d !== undefined && d <= 30;
          reason = d !== undefined ? `Last scan ${d} days ago` : "No scan date recorded";
          break;
        }
        case "audit_logging":
          passed = facts.loggingEnabled === true;
          reason = facts.loggingEnabled === true ? "Logging enabled" : "Logging not confirmed enabled";
          break;
        case "change_approval":
          passed = facts.approvedChanges !== undefined && facts.totalChanges !== undefined &&
            (facts.totalChanges === 0 || facts.approvedChanges >= facts.totalChanges);
          reason = `${facts.approvedChanges ?? 0}/${facts.totalChanges ?? 0} changes approved`;
          break;
      }
      cfg.lastRun = now;
      cfg.lastResult = passed ? "pass" : "fail";
      results.push({ checkId: id, title: meta.title, passed, reason, mapsTo: meta.maps });
      // Auto-update mapped controls.
      for (const ctl of controls) {
        if (meta.maps.includes(ctl.ref)) {
          ctl.status = passed ? "pass" : "fail";
          ctl.lastAssessedAt = now;
          ctl.notes = `Auto: ${meta.title} — ${reason}`;
          autoUpdatedControls++;
        }
      }
    }
    state.monitors.set(userId, configured);
    saveAuditState();
    const passed = results.filter(r => r.passed).length;
    return {
      ok: true,
      result: {
        ranAt: now,
        totalChecks: results.length,
        passed,
        failed: results.length - passed,
        autoUpdatedControls,
        results,
      },
    };
  });

  // ── Feature 4: Audit findings tracker with remediation owner + due date ──

  registerLensAction("audit", "findingAdd", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (!state.findings.has(userId)) state.findings.set(userId, []);
    const validSev = ["critical", "high", "medium", "low"];
    const finding = {
      id: uid("fnd"),
      title,
      description: String(params.description || ""),
      severity: validSev.includes(params.severity) ? params.severity : "medium",
      controlId: params.controlId ? String(params.controlId) : null,
      owner: params.owner ? String(params.owner) : null,
      dueDate: params.dueDate ? String(params.dueDate) : null,
      status: "open", // open | in_progress | remediated | closed
      remediationPlan: String(params.remediationPlan || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.findings.get(userId).push(finding);
    saveAuditState();
    return { ok: true, result: { finding } };
  });

  registerLensAction("audit", "findingUpdate", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const list = state.findings.get(userId) || [];
    const f = list.find(x => x.id === params.id);
    if (!f) return { ok: false, error: "Finding not found" };
    const validStatus = ["open", "in_progress", "remediated", "closed"];
    if (params.status !== undefined) {
      if (!validStatus.includes(params.status)) return { ok: false, error: "Invalid status" };
      f.status = params.status;
    }
    if (params.owner !== undefined) f.owner = params.owner ? String(params.owner) : null;
    if (params.dueDate !== undefined) f.dueDate = params.dueDate ? String(params.dueDate) : null;
    if (params.remediationPlan !== undefined) f.remediationPlan = String(params.remediationPlan);
    if (params.severity !== undefined && ["critical", "high", "medium", "low"].includes(params.severity)) {
      f.severity = params.severity;
    }
    f.updatedAt = new Date().toISOString();
    saveAuditState();
    return { ok: true, result: { finding: f } };
  });

  registerLensAction("audit", "findingList", (ctx, _artifact, params = {}) => {
  try {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    let list = state.findings.get(userId) || [];
    if (params.status) list = list.filter(f => f.status === params.status);
    if (params.severity) list = list.filter(f => f.severity === params.severity);
    const now = Date.now();
    const enriched = list.map(f => ({
      ...f,
      overdue: f.dueDate && f.status !== "closed" && f.status !== "remediated"
        ? new Date(f.dueDate).getTime() < now : false,
    }));
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const byStatus = { open: 0, in_progress: 0, remediated: 0, closed: 0 };
    for (const f of enriched) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        findings: enriched.sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3 };
          return order[a.severity] - order[b.severity];
        }),
        summary: {
          total: enriched.length,
          bySeverity,
          byStatus,
          overdue: enriched.filter(f => f.overdue).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Feature 5: Policy library + acceptance tracking ──

  registerLensAction("audit", "policyAdd", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (!state.policies.has(userId)) state.policies.set(userId, []);
    const policy = {
      id: uid("pol"),
      title,
      category: String(params.category || "general"),
      version: String(params.version || "1.0"),
      body: String(params.body || ""),
      effectiveDate: params.effectiveDate ? String(params.effectiveDate) : new Date().toISOString().slice(0, 10),
      reviewCycleDays: Number.isFinite(params.reviewCycleDays) ? params.reviewCycleDays : 365,
      createdAt: new Date().toISOString(),
    };
    state.policies.get(userId).push(policy);
    saveAuditState();
    return { ok: true, result: { policy } };
  });

  registerLensAction("audit", "policyList", (ctx, _artifact, _params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const list = state.policies.get(userId) || [];
    const acceptances = state.policyAcceptance.get(userId) || [];
    const now = Date.now();
    const enriched = list.map(p => {
      const accs = acceptances.filter(a => a.policyId === p.id);
      const reviewDue = new Date(p.effectiveDate).getTime() + p.reviewCycleDays * 86400000;
      return {
        ...p,
        acceptanceCount: accs.length,
        reviewOverdue: reviewDue < now,
        nextReviewDate: new Date(reviewDue).toISOString().slice(0, 10),
      };
    });
    return { ok: true, result: { policies: enriched, total: enriched.length } };
  });

  registerLensAction("audit", "policyAccept", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const policyId = String(params.policyId || "").trim();
    const policies = state.policies.get(userId) || [];
    const policy = policies.find(p => p.id === policyId);
    if (!policy) return { ok: false, error: "Policy not found" };
    const acceptedBy = String(params.acceptedBy || "").trim();
    if (!acceptedBy) return { ok: false, error: "acceptedBy required" };
    if (!state.policyAcceptance.has(userId)) state.policyAcceptance.set(userId, []);
    const list = state.policyAcceptance.get(userId);
    // One acceptance per (policy, version, person).
    const existing = list.find(a => a.policyId === policyId && a.version === policy.version && a.acceptedBy === acceptedBy);
    if (existing) return { ok: true, result: { acceptance: existing, duplicate: true } };
    const acceptance = {
      id: uid("acc"),
      policyId,
      policyTitle: policy.title,
      version: policy.version,
      acceptedBy,
      acceptedAt: new Date().toISOString(),
    };
    list.push(acceptance);
    saveAuditState();
    return { ok: true, result: { acceptance } };
  });

  registerLensAction("audit", "policyAcceptanceList", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    let list = state.policyAcceptance.get(userId) || [];
    if (params.policyId) list = list.filter(a => a.policyId === params.policyId);
    return { ok: true, result: { acceptances: list, total: list.length } };
  });

  // ── Feature 6: Exportable audit report / auditor-shareable view ──

  registerLensAction("audit", "exportReport", (ctx, _artifact, params = {}) => {
  try {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const controls = state.controls.get(userId) || [];
    const evidence = state.evidence.get(userId) || [];
    const findings = state.findings.get(userId) || [];
    const policies = state.policies.get(userId) || [];
    const acceptances = state.policyAcceptance.get(userId) || [];
    const vendors = state.vendors.get(userId) || [];

    const byFramework = {};
    for (const c of controls) {
      if (!byFramework[c.framework]) byFramework[c.framework] = { pass: 0, fail: 0, not_assessed: 0, not_applicable: 0, total: 0 };
      byFramework[c.framework][c.status] = (byFramework[c.framework][c.status] || 0) + 1;
      byFramework[c.framework].total++;
    }
    for (const fw of Object.keys(byFramework)) {
      const b = byFramework[fw];
      const assessable = b.pass + b.fail;
      b.complianceRate = assessable > 0 ? Math.round((b.pass / assessable) * 1000) / 10 : 0;
      b.name = FRAMEWORKS[fw]?.name || fw;
    }

    const openFindings = findings.filter(f => f.status !== "closed" && f.status !== "remediated");
    const report = {
      generatedAt: new Date().toISOString(),
      reportId: uid("rpt"),
      title: params.title ? String(params.title) : "Compliance Audit Report",
      organization: params.organization ? String(params.organization) : "Concord Tenant",
      summary: {
        frameworksAdopted: Object.keys(byFramework).length,
        totalControls: controls.length,
        controlsPassing: controls.filter(c => c.status === "pass").length,
        evidenceItems: evidence.length,
        openFindings: openFindings.length,
        criticalFindings: openFindings.filter(f => f.severity === "critical").length,
        policies: policies.length,
        policyAcceptances: acceptances.length,
        vendors: vendors.length,
        highRiskVendors: vendors.filter(v => v.riskTier === "high").length,
      },
      frameworkBreakdown: byFramework,
      controls: controls.map(c => ({
        framework: c.framework, ref: c.ref, title: c.title,
        status: c.status, owner: c.owner,
        evidenceCount: evidence.filter(e => e.controlId === c.id).length,
        lastAssessedAt: c.lastAssessedAt,
      })),
      findings: findings.map(f => ({
        title: f.title, severity: f.severity, status: f.status,
        owner: f.owner, dueDate: f.dueDate,
      })),
      policies: policies.map(p => ({
        title: p.title, version: p.version, category: p.category,
        acceptanceCount: acceptances.filter(a => a.policyId === p.id).length,
      })),
      vendors: vendors.map(v => ({
        name: v.name, riskTier: v.riskTier, status: v.status,
        dataAccess: v.dataAccess,
      })),
    };
    // Markdown rendering for auditor-shareable view.
    const md = [
      `# ${report.title}`,
      ``,
      `**Organization:** ${report.organization}  `,
      `**Generated:** ${report.generatedAt}  `,
      `**Report ID:** ${report.reportId}`,
      ``,
      `## Executive Summary`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| Frameworks adopted | ${report.summary.frameworksAdopted} |`,
      `| Total controls | ${report.summary.totalControls} |`,
      `| Controls passing | ${report.summary.controlsPassing} |`,
      `| Evidence items | ${report.summary.evidenceItems} |`,
      `| Open findings | ${report.summary.openFindings} |`,
      `| Critical findings | ${report.summary.criticalFindings} |`,
      `| Policies | ${report.summary.policies} |`,
      `| Policy acceptances | ${report.summary.policyAcceptances} |`,
      `| Vendors tracked | ${report.summary.vendors} |`,
      ``,
      `## Framework Compliance`,
      ``,
      ...Object.entries(byFramework).map(([, b]) =>
        `- **${b.name}** — ${b.complianceRate}% (${b.pass} pass / ${b.fail} fail / ${b.not_assessed} not assessed)`),
      ``,
      `## Open Findings`,
      ``,
      openFindings.length === 0
        ? `_No open findings._`
        : openFindings.map(f => `- [${f.severity.toUpperCase()}] ${f.title} — owner: ${f.owner || "unassigned"}, due: ${f.dueDate || "n/a"}`).join("\n"),
    ].join("\n");

    return { ok: true, result: { report, markdown: md } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Feature 7: Vendor / third-party risk register ──

  registerLensAction("audit", "vendorAdd", (ctx, _artifact, params = {}) => {
  try {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (!state.vendors.has(userId)) state.vendors.set(userId, []);
    const validAccess = ["none", "metadata", "pii", "sensitive", "critical"];
    const dataAccess = validAccess.includes(params.dataAccess) ? params.dataAccess : "none";
    // Inherent risk tier derived from data access + criticality.
    const accessWeight = { none: 0, metadata: 1, pii: 2, sensitive: 3, critical: 4 };
    const criticality = ["low", "medium", "high"].includes(params.criticality) ? params.criticality : "medium";
    const critWeight = { low: 0, medium: 1, high: 2 };
    const score = accessWeight[dataAccess] + critWeight[criticality];
    const riskTier = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
    const vendor = {
      id: uid("ven"),
      name,
      service: String(params.service || ""),
      dataAccess,
      criticality,
      riskScore: score,
      riskTier,
      status: "active", // active | under_review | offboarded
      contact: String(params.contact || ""),
      certifications: Array.isArray(params.certifications) ? params.certifications.map(String) : [],
      lastReviewDate: params.lastReviewDate ? String(params.lastReviewDate) : null,
      notes: String(params.notes || ""),
      createdAt: new Date().toISOString(),
    };
    state.vendors.get(userId).push(vendor);
    saveAuditState();
    return { ok: true, result: { vendor } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("audit", "vendorUpdate", (ctx, _artifact, params = {}) => {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    const list = state.vendors.get(userId) || [];
    const v = list.find(x => x.id === params.id);
    if (!v) return { ok: false, error: "Vendor not found" };
    if (params.status !== undefined) {
      if (!["active", "under_review", "offboarded"].includes(params.status)) {
        return { ok: false, error: "Invalid status" };
      }
      v.status = params.status;
    }
    if (params.lastReviewDate !== undefined) v.lastReviewDate = params.lastReviewDate ? String(params.lastReviewDate) : null;
    if (params.notes !== undefined) v.notes = String(params.notes);
    if (params.certifications !== undefined && Array.isArray(params.certifications)) {
      v.certifications = params.certifications.map(String);
    }
    // Recompute risk if access/criticality changed.
    if (params.dataAccess !== undefined || params.criticality !== undefined) {
      const validAccess = ["none", "metadata", "pii", "sensitive", "critical"];
      if (params.dataAccess !== undefined && validAccess.includes(params.dataAccess)) v.dataAccess = params.dataAccess;
      if (params.criticality !== undefined && ["low", "medium", "high"].includes(params.criticality)) v.criticality = params.criticality;
      const accessWeight = { none: 0, metadata: 1, pii: 2, sensitive: 3, critical: 4 };
      const critWeight = { low: 0, medium: 1, high: 2 };
      v.riskScore = accessWeight[v.dataAccess] + critWeight[v.criticality];
      v.riskTier = v.riskScore >= 5 ? "high" : v.riskScore >= 3 ? "medium" : "low";
    }
    saveAuditState();
    return { ok: true, result: { vendor: v } };
  });

  registerLensAction("audit", "vendorList", (ctx, _artifact, params = {}) => {
  try {
    const state = getAuditState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = actorId(ctx);
    let list = state.vendors.get(userId) || [];
    if (params.riskTier) list = list.filter(v => v.riskTier === params.riskTier);
    if (params.status) list = list.filter(v => v.status === params.status);
    const now = Date.now();
    const enriched = list.map(v => ({
      ...v,
      reviewOverdue: v.lastReviewDate
        ? new Date(v.lastReviewDate).getTime() + 365 * 86400000 < now
        : true,
    }));
    const byTier = { high: 0, medium: 0, low: 0 };
    for (const v of enriched) byTier[v.riskTier] = (byTier[v.riskTier] || 0) + 1;
    return {
      ok: true,
      result: {
        vendors: enriched.sort((a, b) => b.riskScore - a.riskScore),
        summary: {
          total: enriched.length,
          byTier,
          reviewOverdue: enriched.filter(v => v.reviewOverdue).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
