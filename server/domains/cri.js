// server/domains/cri.js
// Domain actions for crisis management: severity assessment, response
// timeline generation, and stakeholder impact mapping.

export default function registerCriActions(registerLensAction) {
  /**
   * severityAssessment
   * Assess crisis severity using multi-factor scoring: scope, impact,
   * urgency, and controllability. Computes composite severity level.
   * artifact.data.crisis = { description?, scope: 1-5, impact: 1-5, urgency: 1-5, controllability: 1-5, affectedSystems?: [], casualties?: number, financialExposure?: number }
   */
  registerLensAction("cri", "severityAssessment", (ctx, artifact, params) => {
    const crisis = artifact.data?.crisis || {};

    // Factor scores (1-5 scale, default to 3 if missing)
    const scope = Math.max(1, Math.min(5, crisis.scope || 3));
    const impact = Math.max(1, Math.min(5, crisis.impact || 3));
    const urgency = Math.max(1, Math.min(5, crisis.urgency || 3));
    const controllability = Math.max(1, Math.min(5, crisis.controllability || 3));

    // Weights for composite score (urgency and impact weigh more)
    const weights = { scope: 0.2, impact: 0.3, urgency: 0.3, controllability: 0.2 };

    // Controllability is inverse — higher controllability reduces severity
    const invertedControllability = 6 - controllability;

    const weightedScore =
      scope * weights.scope +
      impact * weights.impact +
      urgency * weights.urgency +
      invertedControllability * weights.controllability;

    // Normalize to 0-100
    const normalizedScore = Math.round(((weightedScore - 1) / 4) * 100);

    // Escalation modifiers
    let escalationModifier = 0;
    if (crisis.casualties && crisis.casualties > 0) escalationModifier += 20;
    if (crisis.financialExposure && crisis.financialExposure > 1000000) escalationModifier += 10;
    if ((crisis.affectedSystems || []).length > 5) escalationModifier += 10;

    const finalScore = Math.min(100, normalizedScore + escalationModifier);

    // Severity level determination
    let severityLevel, color, responseProtocol;
    if (finalScore >= 80) {
      severityLevel = "critical";
      color = "red";
      responseProtocol = "Immediate executive escalation, all-hands response, external communications within 1 hour";
    } else if (finalScore >= 60) {
      severityLevel = "high";
      color = "orange";
      responseProtocol = "Senior leadership notification, dedicated response team, communications within 4 hours";
    } else if (finalScore >= 40) {
      severityLevel = "moderate";
      color = "yellow";
      responseProtocol = "Manager-level response, monitor escalation, communications within 24 hours";
    } else if (finalScore >= 20) {
      severityLevel = "low";
      color = "blue";
      responseProtocol = "Standard incident process, scheduled review";
    } else {
      severityLevel = "minimal";
      color = "green";
      responseProtocol = "Log and monitor, no immediate action required";
    }

    // Factor analysis: which factors drive severity most
    const factorContributions = [
      { factor: "scope", score: scope, weightedContribution: Math.round(scope * weights.scope * 100) / 100 },
      { factor: "impact", score: impact, weightedContribution: Math.round(impact * weights.impact * 100) / 100 },
      { factor: "urgency", score: urgency, weightedContribution: Math.round(urgency * weights.urgency * 100) / 100 },
      { factor: "controllability", score: controllability, invertedScore: invertedControllability, weightedContribution: Math.round(invertedControllability * weights.controllability * 100) / 100 },
    ].sort((a, b) => b.weightedContribution - a.weightedContribution);

    artifact.data.severityAssessment = { score: finalScore, level: severityLevel, timestamp: new Date().toISOString() };

    return {
      ok: true, result: {
        severityScore: finalScore,
        severityLevel,
        color,
        responseProtocol,
        factors: {
          scope: { score: scope, label: ["", "isolated", "local", "regional", "national", "global"][scope] },
          impact: { score: impact, label: ["", "negligible", "minor", "moderate", "major", "catastrophic"][impact] },
          urgency: { score: urgency, label: ["", "scheduled", "planned", "prompt", "immediate", "flash"][urgency] },
          controllability: { score: controllability, label: ["", "uncontrollable", "difficult", "manageable", "contained", "fully controlled"][controllability] },
        },
        factorContributions,
        escalationModifiers: {
          casualties: crisis.casualties || 0,
          financialExposure: crisis.financialExposure || 0,
          affectedSystemCount: (crisis.affectedSystems || []).length,
          totalModifier: escalationModifier,
        },
        rawWeightedScore: Math.round(weightedScore * 100) / 100,
      },
    };
  });

  /**
   * responseTimeline
   * Generate crisis response timeline: critical path through response steps,
   * resource allocation, and SLA tracking.
   * artifact.data.responseSteps = [{ name, durationMinutes, dependencies?: [stepName], resources?: [string], sla?: number }]
   * artifact.data.startTime = ISO timestamp (default now)
   */
  registerLensAction("cri", "responseTimeline", (ctx, artifact, params) => {
    const steps = artifact.data?.responseSteps || [];
    if (steps.length === 0) return { ok: true, result: { message: "No response steps defined." } };

    const startTime = new Date(artifact.data?.startTime || Date.now());

    // Build dependency graph and compute earliest start/finish (forward pass)
    const stepMap = {};
    for (const step of steps) {
      stepMap[step.name] = {
        ...step,
        duration: step.durationMinutes || 0,
        deps: step.dependencies || [],
        es: 0, // earliest start
        ef: 0, // earliest finish
        ls: Infinity, // latest start
        lf: Infinity, // latest finish
        slack: 0,
      };
    }

    // Topological sort via Kahn's algorithm
    const inDegree = {};
    const adjList = {};
    for (const name of Object.keys(stepMap)) {
      inDegree[name] = 0;
      adjList[name] = [];
    }
    for (const step of Object.values(stepMap)) {
      for (const dep of step.deps) {
        if (stepMap[dep]) {
          adjList[dep].push(step.name);
          inDegree[step.name]++;
        }
      }
    }

    const queue = Object.keys(inDegree).filter(n => inDegree[n] === 0);
    const topoOrder = [];
    while (queue.length > 0) {
      const current = queue.shift();
      topoOrder.push(current);
      for (const neighbor of adjList[current]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) queue.push(neighbor);
      }
    }

    // Detect cycles
    if (topoOrder.length !== Object.keys(stepMap).length) {
      return { ok: false, error: "Circular dependency detected in response steps." };
    }

    // Forward pass: earliest start and finish
    for (const name of topoOrder) {
      const step = stepMap[name];
      for (const dep of step.deps) {
        if (stepMap[dep]) {
          step.es = Math.max(step.es, stepMap[dep].ef);
        }
      }
      step.ef = step.es + step.duration;
    }

    // Project total duration
    const totalDuration = Math.max(...Object.values(stepMap).map(s => s.ef));

    // Backward pass: latest start and finish
    for (const name of Object.keys(stepMap)) {
      stepMap[name].lf = totalDuration;
    }
    for (const name of [...topoOrder].reverse()) {
      const step = stepMap[name];
      for (const successor of adjList[name]) {
        step.lf = Math.min(step.lf, stepMap[successor].ls);
      }
      step.ls = step.lf - step.duration;
      step.slack = step.ls - step.es;
    }

    // Critical path: steps with zero slack
    const criticalPath = topoOrder.filter(n => stepMap[n].slack === 0);

    // Build timeline with absolute timestamps
    const timeline = topoOrder.map(name => {
      const step = stepMap[name];
      const absoluteStart = new Date(startTime.getTime() + step.es * 60000);
      const absoluteEnd = new Date(startTime.getTime() + step.ef * 60000);
      const slaDeadline = step.sla ? new Date(startTime.getTime() + step.sla * 60000) : null;
      const slaStatus = slaDeadline
        ? (step.ef <= step.sla ? "within_sla" : "sla_breach")
        : "no_sla";

      return {
        name,
        startMinute: step.es,
        endMinute: step.ef,
        duration: step.duration,
        slack: step.slack,
        isCritical: step.slack === 0,
        absoluteStart: absoluteStart.toISOString(),
        absoluteEnd: absoluteEnd.toISOString(),
        resources: step.resources || [],
        slaStatus,
        slaDeadline: slaDeadline ? slaDeadline.toISOString() : null,
      };
    });

    // Resource allocation summary
    const resourceLoad = {};
    for (const step of timeline) {
      for (const resource of step.resources) {
        if (!resourceLoad[resource]) resourceLoad[resource] = { totalMinutes: 0, steps: [] };
        resourceLoad[resource].totalMinutes += step.duration;
        resourceLoad[resource].steps.push(step.name);
      }
    }

    // SLA summary
    const slaBreaches = timeline.filter(t => t.slaStatus === "sla_breach");

    artifact.data.timeline = timeline;

    return {
      ok: true, result: {
        timeline,
        criticalPath,
        totalDurationMinutes: totalDuration,
        estimatedCompletion: new Date(startTime.getTime() + totalDuration * 60000).toISOString(),
        startTime: startTime.toISOString(),
        resourceAllocation: resourceLoad,
        sla: {
          breaches: slaBreaches.length,
          breachedSteps: slaBreaches.map(s => s.name),
          allWithinSla: slaBreaches.length === 0,
        },
        stepCount: steps.length,
        criticalPathLength: criticalPath.length,
      },
    };
  });

  /**
   * stakeholderImpact
   * Map stakeholder impact: identify affected parties, score impact magnitude,
   * and prioritize communication order.
   * artifact.data.stakeholders = [{ name, type: "internal"|"external"|"regulatory", influence: 1-5, dependence: 1-5, proximity?: 1-5 }]
   * artifact.data.crisisType = string (optional context)
   */
  registerLensAction("cri", "stakeholderImpact", (ctx, artifact, params) => {
    const stakeholders = artifact.data?.stakeholders || [];
    if (stakeholders.length === 0) return { ok: true, result: { message: "No stakeholders defined." } };

    const crisisType = artifact.data?.crisisType || "general";

    // Type-based urgency multipliers
    const typeMultiplier = { regulatory: 1.5, external: 1.2, internal: 1.0 };

    const scored = stakeholders.map(sh => {
      const influence = Math.max(1, Math.min(5, sh.influence || 3));
      const dependence = Math.max(1, Math.min(5, sh.dependence || 3));
      const proximity = Math.max(1, Math.min(5, sh.proximity || 3));
      const multiplier = typeMultiplier[sh.type] || 1.0;

      // Impact magnitude: weighted combination
      const rawImpact = (influence * 0.35 + dependence * 0.35 + proximity * 0.3) * multiplier;
      const impactScore = Math.round(Math.min(10, rawImpact * 2) * 100) / 100;

      // Communication urgency: higher impact + regulatory = more urgent
      const urgencyScore = Math.round((impactScore * (sh.type === "regulatory" ? 1.3 : 1.0)) * 100) / 100;

      // Stakeholder quadrant (power/interest matrix)
      let quadrant;
      if (influence >= 3 && dependence >= 3) quadrant = "manage_closely";
      else if (influence >= 3 && dependence < 3) quadrant = "keep_satisfied";
      else if (influence < 3 && dependence >= 3) quadrant = "keep_informed";
      else quadrant = "monitor";

      return {
        name: sh.name,
        type: sh.type || "internal",
        influence,
        dependence,
        proximity,
        impactScore,
        urgencyScore,
        quadrant,
      };
    });

    // Sort by urgency for communication priority
    const communicationOrder = [...scored].sort((a, b) => b.urgencyScore - a.urgencyScore);

    // Assign communication tiers
    const tiered = communicationOrder.map((sh, idx) => {
      let tier, timeframe;
      const position = idx / communicationOrder.length;
      if (position < 0.25) { tier = 1; timeframe = "within 1 hour"; }
      else if (position < 0.5) { tier = 2; timeframe = "within 4 hours"; }
      else if (position < 0.75) { tier = 3; timeframe = "within 24 hours"; }
      else { tier = 4; timeframe = "within 72 hours"; }
      return { ...sh, communicationTier: tier, communicationTimeframe: timeframe };
    });

    // Quadrant summary
    const quadrantSummary = {};
    for (const sh of scored) {
      if (!quadrantSummary[sh.quadrant]) quadrantSummary[sh.quadrant] = { count: 0, stakeholders: [] };
      quadrantSummary[sh.quadrant].count++;
      quadrantSummary[sh.quadrant].stakeholders.push(sh.name);
    }

    // Type distribution
    const typeDistribution = {};
    for (const sh of scored) {
      typeDistribution[sh.type] = (typeDistribution[sh.type] || 0) + 1;
    }

    // Risk concentration: are most high-impact stakeholders in one type?
    const typeAvgImpact = {};
    for (const sh of scored) {
      if (!typeAvgImpact[sh.type]) typeAvgImpact[sh.type] = { sum: 0, count: 0 };
      typeAvgImpact[sh.type].sum += sh.impactScore;
      typeAvgImpact[sh.type].count++;
    }
    const typeImpactSummary = Object.entries(typeAvgImpact).map(([type, data]) => ({
      type,
      count: data.count,
      avgImpact: Math.round((data.sum / data.count) * 100) / 100,
    }));

    artifact.data.stakeholderMap = tiered;

    return {
      ok: true, result: {
        communicationPriority: tiered,
        quadrantAnalysis: quadrantSummary,
        typeDistribution,
        typeImpactSummary,
        metrics: {
          totalStakeholders: stakeholders.length,
          avgImpactScore: Math.round((scored.reduce((s, sh) => s + sh.impactScore, 0) / scored.length) * 100) / 100,
          maxImpactScore: Math.max(...scored.map(s => s.impactScore)),
          tier1Count: tiered.filter(s => s.communicationTier === 1).length,
          regulatoryCount: typeDistribution.regulatory || 0,
        },
        crisisType,
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2026 parity — data-quality scorecard tooling (Monte Carlo / Great
  // Expectations analog). Adds the quality-loop features: trend tracking,
  // configurable scoring rules, bulk remediation, regression alerting,
  // root-cause linkage, and side-by-side DTU comparison. Per-user scoped
  // against globalThis._concordSTATE.
  // ─────────────────────────────────────────────────────────────────────────

  const CRETI_DIMS = ["coherence", "relevance", "evidence", "timeliness", "integration"];
  const DEFAULT_WEIGHTS = { coherence: 0.2, relevance: 0.2, evidence: 0.25, timeliness: 0.15, integration: 0.2 };
  const DEFAULT_THRESHOLDS = { critical: 0.3, warning: 0.55, healthy: 0.75 };

  // Root-cause remediation playbook — concrete fixes per CRETI dimension.
  const DIMENSION_FIXES = {
    coherence: [
      "Split the DTU into atomic claims — one assertion per core layer entry",
      "Remove contradictory statements; reconcile against the human summary",
      "Add explicit logical connectives between claims (therefore / because / despite)",
    ],
    relevance: [
      "Retag the DTU so machine-layer tags match its actual domain",
      "Trim tangential content that dilutes the central thesis",
      "Link the DTU to the parent topic cluster it belongs to",
    ],
    evidence: [
      "Attach at least one citation or source artifact to the evidence layer",
      "Replace assertions with verifiable claims (numbers, dates, named sources)",
      "Add a verifier note in the machine layer describing how claims were checked",
    ],
    timeliness: [
      "Refresh stale figures — re-pull from the source API or re-date the claim",
      "Add a 'valid-as-of' timestamp to the core layer",
      "Schedule the DTU for a consolidation pass to fold in newer data",
    ],
    integration: [
      "Add edges to related DTUs so it participates in the knowledge graph",
      "Cross-reference complementary DTUs in the same domain",
      "Promote into a MEGA cluster if it has 5+ siblings",
    ],
  };

  function getCriState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.criLens) {
      STATE.criLens = {
        snapshots: new Map(), // userId -> Array<{ at, count, scored, avg, dims:{} }>
        rules: new Map(),     // userId -> { weights:{}, thresholds:{} }
        flags: new Map(),     // userId -> Map<dtuId, { dtuId, title, score, status, note, at }>
        alerts: new Map(),    // userId -> Array<{ id, dtuId, title, prev, current, drop, at, acknowledged }>
        baselines: new Map(), // userId -> Map<dtuId, { score, at }>
      };
    }
    return STATE.criLens;
  }
  function saveCriState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function criActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextCriId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function criNow() { return new Date().toISOString(); }
  function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

  function getRules(s, userId) {
    const stored = s.rules.get(userId);
    if (stored) return stored;
    return { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } };
  }

  // Recompute a composite score for a DTU given a weight map (normalized).
  function compositeWith(creti, weights) {
    if (!creti) return 0;
    let total = 0, wsum = 0;
    for (const dim of CRETI_DIMS) {
      const v = creti[dim];
      if (typeof v === "number") {
        const w = weights[dim] ?? 0;
        total += v * w;
        wsum += w;
      }
    }
    return wsum > 0 ? total / wsum : 0;
  }

  // Normalize a dtu shape: macros accept dtus passed straight from /api/dtus.
  function normDtu(d) {
    return {
      id: String(d?.id || ""),
      title: d?.title || d?.summary || (d?.id ? String(d.id).slice(0, 8) : "untitled"),
      creti: d?.creti && typeof d.creti === "object" ? d.creti : null,
    };
  }

  /**
   * scoreRules-get / scoreRules-set
   * Configurable CRETI weighting + thresholds. Weights are stored as given
   * and applied normalized (so they need not sum to 1).
   */
  registerLensAction("cri", "scoreRules-get", (ctx, _artifact, _params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    return {
      ok: true,
      result: {
        ...getRules(s, userId),
        defaults: { weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS },
        isCustom: s.rules.has(userId),
        dimensions: CRETI_DIMS,
      },
    };
  });

  registerLensAction("cri", "scoreRules-set", (ctx, _artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);

    if (params.reset === true) {
      s.rules.delete(userId);
      saveCriState();
      return { ok: true, result: { weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS }, isCustom: false } };
    }

    const current = getRules(s, userId);
    const weights = { ...current.weights };
    const thresholds = { ...current.thresholds };

    if (params.weights && typeof params.weights === "object") {
      for (const dim of CRETI_DIMS) {
        if (params.weights[dim] != null) {
          const w = Number(params.weights[dim]);
          if (!Number.isFinite(w) || w < 0 || w > 1) return { ok: false, error: `weight for ${dim} must be 0..1` };
          weights[dim] = Math.round(w * 1000) / 1000;
        }
      }
    }
    if (params.thresholds && typeof params.thresholds === "object") {
      for (const k of ["critical", "warning", "healthy"]) {
        if (params.thresholds[k] != null) {
          const t = Number(params.thresholds[k]);
          if (!Number.isFinite(t) || t < 0 || t > 1) return { ok: false, error: `threshold ${k} must be 0..1` };
          thresholds[k] = Math.round(t * 1000) / 1000;
        }
      }
    }
    if (!(thresholds.critical <= thresholds.warning && thresholds.warning <= thresholds.healthy)) {
      return { ok: false, error: "thresholds must satisfy critical <= warning <= healthy" };
    }

    const wsum = CRETI_DIMS.reduce((a, d) => a + (weights[d] || 0), 0);
    if (wsum <= 0) return { ok: false, error: "at least one weight must be positive" };

    s.rules.set(userId, { weights, thresholds });
    saveCriState();
    return { ok: true, result: { weights, thresholds, weightSum: Math.round(wsum * 1000) / 1000, isCustom: true } };
  });

  /**
   * trend-snapshot
   * Record a corpus quality snapshot (call when the lens loads a DTU list).
   * artifact.data.dtus or params.dtus = [{ id, title?, creti }]
   */
  registerLensAction("cri", "trend-snapshot", (ctx, artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const raw = params.dtus || artifact?.data?.dtus || [];
    if (!Array.isArray(raw)) return { ok: false, error: "dtus must be an array" };

    const rules = getRules(s, userId);
    const dtus = raw.map(normDtu);
    const scored = dtus.filter(d => d.creti);
    const composites = scored.map(d => compositeWith(d.creti, rules.weights));
    const avg = composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : 0;

    const dims = {};
    for (const dim of CRETI_DIMS) {
      const vals = scored.map(d => d.creti[dim]).filter(v => typeof v === "number");
      dims[dim] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }

    const snap = {
      at: criNow(),
      count: dtus.length,
      scored: scored.length,
      avg: Math.round(avg * 1000) / 1000,
      min: composites.length ? Math.round(Math.min(...composites) * 1000) / 1000 : 0,
      max: composites.length ? Math.round(Math.max(...composites) * 1000) / 1000 : 0,
      dims: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    };

    let history = s.snapshots.get(userId) || [];
    history = [...history, snap].slice(-200); // keep last 200
    s.snapshots.set(userId, history);

    // Update per-DTU baselines + detect regressions.
    const baselines = s.baselines.get(userId) || new Map();
    const alerts = s.alerts.get(userId) || [];
    const rules2 = rules;
    const newAlerts = [];
    for (const d of scored) {
      const cur = compositeWith(d.creti, rules2.weights);
      const prev = baselines.get(d.id);
      if (prev && prev.score - cur >= 0.1 && cur < rules2.thresholds.warning) {
        const alert = {
          id: nextCriId("alert"),
          dtuId: d.id,
          title: d.title,
          prev: Math.round(prev.score * 1000) / 1000,
          current: Math.round(cur * 1000) / 1000,
          drop: Math.round((prev.score - cur) * 1000) / 1000,
          at: criNow(),
          acknowledged: false,
        };
        newAlerts.push(alert);
      }
      baselines.set(d.id, { score: cur, at: snap.at });
    }
    s.baselines.set(userId, baselines);
    if (newAlerts.length) s.alerts.set(userId, [...alerts, ...newAlerts].slice(-100));
    saveCriState();

    return { ok: true, result: { snapshot: snap, snapshotCount: history.length, regressionsDetected: newAlerts.length } };
  });

  /**
   * trend-history
   * Return recorded corpus snapshots + deltas for charting trend over time.
   */
  registerLensAction("cri", "trend-history", (ctx, _artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const limit = Math.max(2, Math.min(200, Number(params.limit) || 60));
    const history = (s.snapshots.get(userId) || []).slice(-limit);

    let direction = "flat", delta = 0;
    if (history.length >= 2) {
      delta = history[history.length - 1].avg - history[0].avg;
      direction = delta > 0.02 ? "improving" : delta < -0.02 ? "declining" : "flat";
    }
    const dimTrends = {};
    if (history.length >= 2) {
      for (const dim of CRETI_DIMS) {
        dimTrends[dim] = Math.round((history[history.length - 1].dims[dim] - history[0].dims[dim]) * 1000) / 1000;
      }
    }
    return {
      ok: true,
      result: {
        history,
        points: history.length,
        direction,
        delta: Math.round(delta * 1000) / 1000,
        dimTrends,
        latest: history[history.length - 1] || null,
      },
    };
  });

  /**
   * rootCause
   * For a single DTU, identify the weakest contributing dimension(s) and
   * surface concrete fixes. Drives the root-cause linkage panel.
   * params.dtu = { id, title?, creti }
   */
  registerLensAction("cri", "rootCause", (ctx, artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const d = normDtu(params.dtu || artifact?.data?.dtu || {});
    if (!d.id) return { ok: false, error: "dtu with id required" };
    if (!d.creti) return { ok: false, error: "dtu has no CRETI scores" };

    const rules = getRules(s, userId);
    const composite = compositeWith(d.creti, rules.weights);

    // Per-dimension shortfall vs the healthy threshold, weighted by impact.
    const breakdown = CRETI_DIMS
      .map(dim => {
        const value = typeof d.creti[dim] === "number" ? d.creti[dim] : 0;
        const weight = rules.weights[dim] ?? 0;
        const shortfall = Math.max(0, rules.thresholds.healthy - value);
        // weighted drag: how much this dim pulls the composite down
        return {
          dimension: dim,
          value: Math.round(value * 1000) / 1000,
          weight,
          shortfall: Math.round(shortfall * 1000) / 1000,
          weightedDrag: Math.round(shortfall * weight * 1000) / 1000,
          fixes: DIMENSION_FIXES[dim],
        };
      })
      .sort((a, b) => b.weightedDrag - a.weightedDrag);

    const primary = breakdown.find(b => b.weightedDrag > 0) || breakdown[0];
    const contributors = breakdown.filter(b => b.weightedDrag > 0);

    let verdict;
    if (composite >= rules.thresholds.healthy) verdict = "healthy — no remediation needed";
    else if (composite >= rules.thresholds.warning) verdict = "minor — address the primary contributor";
    else if (composite >= rules.thresholds.critical) verdict = "degraded — remediate top 2 contributors";
    else verdict = "critical — full remediation across all weak dimensions";

    return {
      ok: true,
      result: {
        dtuId: d.id,
        title: d.title,
        composite: Math.round(composite * 1000) / 1000,
        verdict,
        primaryCause: primary ? primary.dimension : null,
        breakdown,
        contributors,
        recommendedFixes: contributors.slice(0, 3).flatMap(c => c.fixes.slice(0, 1).map(f => ({ dimension: c.dimension, fix: f }))),
      },
    };
  });

  /**
   * compare
   * Side-by-side quality profile of two DTUs.
   * params.dtuA / params.dtuB = { id, title?, creti }
   */
  registerLensAction("cri", "compare", (ctx, _artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const a = normDtu(params.dtuA || {});
    const b = normDtu(params.dtuB || {});
    if (!a.id || !b.id) return { ok: false, error: "dtuA and dtuB with ids required" };
    if (a.id === b.id) return { ok: false, error: "cannot compare a DTU to itself" };
    if (!a.creti || !b.creti) return { ok: false, error: "both DTUs must have CRETI scores" };

    const rules = getRules(s, userId);
    const compA = compositeWith(a.creti, rules.weights);
    const compB = compositeWith(b.creti, rules.weights);

    const dimensions = CRETI_DIMS.map(dim => {
      const va = typeof a.creti[dim] === "number" ? a.creti[dim] : 0;
      const vb = typeof b.creti[dim] === "number" ? b.creti[dim] : 0;
      return {
        dimension: dim,
        a: Math.round(va * 1000) / 1000,
        b: Math.round(vb * 1000) / 1000,
        delta: Math.round((va - vb) * 1000) / 1000,
        winner: va > vb ? "a" : vb > va ? "b" : "tie",
      };
    });

    const aWins = dimensions.filter(d => d.winner === "a").length;
    const bWins = dimensions.filter(d => d.winner === "b").length;

    return {
      ok: true,
      result: {
        a: { id: a.id, title: a.title, composite: Math.round(compA * 1000) / 1000 },
        b: { id: b.id, title: b.title, composite: Math.round(compB * 1000) / 1000 },
        compositeDelta: Math.round((compA - compB) * 1000) / 1000,
        overallWinner: compA > compB ? "a" : compB > compA ? "b" : "tie",
        dimensions,
        dimensionWins: { a: aWins, b: bWins, tie: dimensions.length - aWins - bWins },
        biggestGap: [...dimensions].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0] || null,
      },
    };
  });

  /**
   * bulkRemediate
   * Flag / queue a batch of low-quality DTUs for improvement. Persistent
   * per-user flag store; supports list / flag / clear actions.
   * params.op = "flag" | "list" | "clear"
   * params.dtus = [{ id, title?, creti }]  (for flag)
   * params.note, params.status ("flagged"|"queued"|"resolved")
   */
  registerLensAction("cri", "bulkRemediate", (ctx, _artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const op = String(params.op || "list");
    const flags = s.flags.get(userId) || new Map();
    const rules = getRules(s, userId);

    if (op === "list") {
      const items = Array.from(flags.values()).sort((x, y) => (y.at || "").localeCompare(x.at || ""));
      return {
        ok: true,
        result: {
          flags: items,
          counts: {
            total: items.length,
            flagged: items.filter(i => i.status === "flagged").length,
            queued: items.filter(i => i.status === "queued").length,
            resolved: items.filter(i => i.status === "resolved").length,
          },
        },
      };
    }

    if (op === "clear") {
      const ids = Array.isArray(params.ids) ? params.ids.map(String) : null;
      let cleared = 0;
      if (ids) {
        for (const id of ids) { if (flags.delete(id)) cleared++; }
      } else {
        cleared = flags.size;
        flags.clear();
      }
      s.flags.set(userId, flags);
      saveCriState();
      return { ok: true, result: { cleared, remaining: flags.size } };
    }

    if (op === "flag") {
      const raw = Array.isArray(params.dtus) ? params.dtus : [];
      if (!raw.length) return { ok: false, error: "dtus array required to flag" };
      const status = ["flagged", "queued", "resolved"].includes(params.status) ? params.status : "flagged";
      const note = String(params.note || "").slice(0, 280);
      const flagged = [];
      for (const d of raw.map(normDtu)) {
        if (!d.id) continue;
        const score = d.creti ? compositeWith(d.creti, rules.weights) : 0;
        const entry = {
          dtuId: d.id,
          title: d.title,
          score: Math.round(score * 1000) / 1000,
          status,
          note,
          at: criNow(),
        };
        flags.set(d.id, entry);
        flagged.push(entry);
      }
      s.flags.set(userId, flags);
      saveCriState();
      return { ok: true, result: { flagged, totalFlags: flags.size, status } };
    }

    return { ok: false, error: `unknown op '${op}' (expected flag|list|clear)` };
  });

  /**
   * alerts
   * List / acknowledge quality-regression alerts (produced by trend-snapshot).
   * params.op = "list" | "ack" | "clear"
   */
  registerLensAction("cri", "alerts", (ctx, _artifact, params = {}) => {
    const s = getCriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = criActor(ctx);
    const op = String(params.op || "list");
    let alerts = s.alerts.get(userId) || [];

    if (op === "ack") {
      const ids = new Set((Array.isArray(params.ids) ? params.ids : [params.id]).filter(Boolean).map(String));
      let acked = 0;
      alerts = alerts.map(a => {
        if (ids.has(a.id) && !a.acknowledged) { acked++; return { ...a, acknowledged: true }; }
        return a;
      });
      s.alerts.set(userId, alerts);
      saveCriState();
      return { ok: true, result: { acknowledged: acked, alerts } };
    }

    if (op === "clear") {
      const before = alerts.length;
      alerts = alerts.filter(a => !a.acknowledged);
      s.alerts.set(userId, alerts);
      saveCriState();
      return { ok: true, result: { cleared: before - alerts.length, remaining: alerts.length } };
    }

    // list
    const sorted = [...alerts].sort((x, y) => (y.at || "").localeCompare(x.at || ""));
    return {
      ok: true,
      result: {
        alerts: sorted,
        unacknowledged: sorted.filter(a => !a.acknowledged).length,
        total: sorted.length,
      },
    };
  });
}
