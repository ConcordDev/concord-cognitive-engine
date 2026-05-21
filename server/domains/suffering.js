// server/domains/suffering.js
// Domain actions for pain point / issue analysis: pain point mapping,
// root cause analysis, and intervention design.

export default function registerSufferingActions(registerLensAction) {
  /**
   * painPointMapping
   * Map pain points from feedback data. Clusters complaints, computes
   * severity scoring, frequency-impact matrix, and Pareto analysis.
   * artifact.data.feedback = [{ text, category?, severity?, impact?, timestamp? }]
   */
  registerLensAction("suffering", "painPointMapping", (ctx, artifact, _params) => {
    const feedback = artifact.data?.feedback || [];
    if (feedback.length === 0) {
      return { ok: true, result: { message: "No feedback data to analyze." } };
    }

    const r = (v) => Math.round(v * 1000) / 1000;

    // Cluster complaints by category
    const clusters = {};
    for (const item of feedback) {
      const cat = (item.category || "uncategorized").toLowerCase();
      if (!clusters[cat]) clusters[cat] = { items: [], severities: [], impacts: [] };
      clusters[cat].items.push(item);
      if (item.severity != null) clusters[cat].severities.push(Number(item.severity));
      if (item.impact != null) clusters[cat].impacts.push(Number(item.impact));
    }

    // Severity scoring per cluster
    const clusterStats = Object.entries(clusters).map(([category, data]) => {
      const count = data.items.length;
      const frequency = count / feedback.length;

      // Average severity (default 5 on 1-10 scale if missing)
      const sevValues = data.severities.length > 0 ? data.severities : [5];
      const avgSeverity = sevValues.reduce((s, v) => s + v, 0) / sevValues.length;
      const maxSeverity = Math.max(...sevValues);

      // Average impact (default 5 on 1-10 scale if missing)
      const impValues = data.impacts.length > 0 ? data.impacts : [5];
      const avgImpact = impValues.reduce((s, v) => s + v, 0) / impValues.length;

      // Composite pain score: frequency-weighted severity * impact
      const painScore = frequency * avgSeverity * avgImpact;

      return {
        category,
        count,
        frequency: r(frequency),
        avgSeverity: r(avgSeverity),
        maxSeverity,
        avgImpact: r(avgImpact),
        painScore: r(painScore),
      };
    });

    // Sort by pain score descending for Pareto analysis
    clusterStats.sort((a, b) => b.painScore - a.painScore);

    // Pareto analysis: cumulative percentage of total pain
    const totalPain = clusterStats.reduce((s, c) => s + c.painScore, 0);
    let cumulative = 0;
    const pareto = clusterStats.map((c) => {
      cumulative += c.painScore;
      const cumulativePercent = totalPain > 0 ? (cumulative / totalPain) * 100 : 0;
      return {
        ...c,
        percentOfTotal: r(totalPain > 0 ? (c.painScore / totalPain) * 100 : 0),
        cumulativePercent: r(cumulativePercent),
        inPareto80: cumulativePercent <= 80 || (cumulativePercent - (totalPain > 0 ? (c.painScore / totalPain) * 100 : 0)) < 80,
      };
    });

    // Identify the vital few (Pareto 80/20)
    const vitalFew = pareto.filter(p => p.inPareto80);

    // Frequency-Impact matrix quadrants
    const medianFreq = (() => {
      const sorted = [...clusterStats].sort((a, b) => a.frequency - b.frequency);
      return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)].frequency : 0;
    })();
    const medianImpact = (() => {
      const sorted = [...clusterStats].sort((a, b) => a.avgImpact - b.avgImpact);
      return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)].avgImpact : 0;
    })();

    const quadrants = {
      criticalUrgent: clusterStats.filter(c => c.frequency >= medianFreq && c.avgImpact >= medianImpact).map(c => c.category),
      highImpactLowFreq: clusterStats.filter(c => c.frequency < medianFreq && c.avgImpact >= medianImpact).map(c => c.category),
      highFreqLowImpact: clusterStats.filter(c => c.frequency >= medianFreq && c.avgImpact < medianImpact).map(c => c.category),
      minor: clusterStats.filter(c => c.frequency < medianFreq && c.avgImpact < medianImpact).map(c => c.category),
    };

    // Trend detection: if timestamps present, compute trend per category
    const trends = {};
    for (const [category, data] of Object.entries(clusters)) {
      const withTs = data.items.filter(i => i.timestamp).map(i => new Date(i.timestamp).getTime()).filter(t => !isNaN(t));
      if (withTs.length >= 3) {
        withTs.sort((a, b) => a - b);
        const midpoint = withTs[Math.floor(withTs.length / 2)];
        const recentCount = withTs.filter(t => t >= midpoint).length;
        const earlyCount = withTs.filter(t => t < midpoint).length;
        trends[category] = recentCount > earlyCount * 1.5 ? "increasing" : recentCount < earlyCount * 0.67 ? "decreasing" : "stable";
      }
    }

    return {
      ok: true,
      result: {
        totalFeedbackItems: feedback.length,
        uniqueCategories: Object.keys(clusters).length,
        painPoints: pareto,
        vitalFew: {
          categories: vitalFew.map(v => v.category),
          count: vitalFew.length,
          percentOfCategories: r((vitalFew.length / clusterStats.length) * 100),
          coversPercentOfPain: vitalFew.length > 0 ? r(vitalFew[vitalFew.length - 1].cumulativePercent) : 0,
        },
        frequencyImpactMatrix: quadrants,
        trends: Object.keys(trends).length > 0 ? trends : null,
        topPainPoint: clusterStats[0] || null,
      },
    };
  });

  /**
   * rootCause
   * Root cause analysis using fault tree / Ishikawa methodology.
   * artifact.data.problem = { description, effects?: string[] }
   * artifact.data.causes = [{ id, description, parentId?, category?, probability?, evidence? }]
   * Categories follow Ishikawa: "people", "process", "technology", "environment", "materials", "measurement"
   */
  registerLensAction("suffering", "rootCause", (ctx, artifact, _params) => {
    const problem = artifact.data?.problem;
    const causes = artifact.data?.causes || [];
    if (!problem) return { ok: false, error: "Problem description required." };
    if (causes.length === 0) return { ok: true, result: { message: "No causes provided for analysis." } };

    const r = (v) => Math.round(v * 1000) / 1000;

    // Build cause tree
    const byId = {};
    const children = {};
    const roots = [];
    for (const c of causes) {
      byId[c.id] = { ...c, probability: c.probability ?? 0.5 };
      if (!children[c.id]) children[c.id] = [];
    }
    for (const c of causes) {
      if (c.parentId && byId[c.parentId]) {
        if (!children[c.parentId]) children[c.parentId] = [];
        children[c.parentId].push(c.id);
      } else {
        roots.push(c.id);
      }
    }

    // Compute branch probabilities (propagate from leaves to root)
    // Combined probability: P(parent) = 1 - product(1 - P(child_i)) for OR gates
    function computeProbability(id) {
      const kids = children[id] || [];
      if (kids.length === 0) return byId[id].probability;
      // OR gate: any child can cause the parent
      const childProbs = kids.map(computeProbability);
      const combinedProb = 1 - childProbs.reduce((prod, p) => prod * (1 - p), 1);
      byId[id].computedProbability = combinedProb;
      return combinedProb;
    }
    for (const rootId of roots) computeProbability(rootId);

    // Compute depth of each cause
    function computeDepth(id, d) {
      byId[id].depth = d;
      for (const childId of (children[id] || [])) computeDepth(childId, d + 1);
    }
    for (const rootId of roots) computeDepth(rootId, 0);

    // Ishikawa categorization
    const ishikawaCategories = ["people", "process", "technology", "environment", "materials", "measurement"];
    const categoryAnalysis = {};
    for (const cat of ishikawaCategories) categoryAnalysis[cat] = { causes: [], totalProbability: 0 };

    for (const c of causes) {
      const cat = (c.category || "uncategorized").toLowerCase();
      if (!categoryAnalysis[cat]) categoryAnalysis[cat] = { causes: [], totalProbability: 0 };
      categoryAnalysis[cat].causes.push({ id: c.id, description: c.description, probability: byId[c.id].computedProbability ?? byId[c.id].probability });
      categoryAnalysis[cat].totalProbability += byId[c.id].computedProbability ?? byId[c.id].probability;
    }

    // Identify leaf causes (no children = root causes in fault tree terms)
    const leafCauses = causes
      .filter(c => (children[c.id] || []).length === 0)
      .map(c => ({
        id: c.id,
        description: c.description,
        category: c.category || "uncategorized",
        probability: byId[c.id].probability,
        evidence: c.evidence || null,
        depth: byId[c.id].depth,
      }))
      .sort((a, b) => b.probability - a.probability);

    // Primary causes: highest probability leaf causes
    const primaryCauses = leafCauses.filter(c => c.probability >= 0.5);

    // Build the tree structure for output
    function buildTree(id) {
      const node = byId[id];
      const kids = children[id] || [];
      return {
        id: node.id,
        description: node.description,
        category: node.category || "uncategorized",
        probability: r(node.computedProbability ?? node.probability),
        children: kids.map(buildTree),
      };
    }
    const causeTree = roots.map(buildTree);

    // Compute maximum tree depth
    const maxDepth = Math.max(...Object.values(byId).map(c => c.depth || 0), 0);

    // Category dominance: which category has the highest combined probability
    const dominantCategory = Object.entries(categoryAnalysis)
      .filter(([, v]) => v.causes.length > 0)
      .sort((a, b) => b[1].totalProbability - a[1].totalProbability)[0];

    return {
      ok: true,
      result: {
        problem: problem.description,
        effects: problem.effects || [],
        totalCauses: causes.length,
        treeDepth: maxDepth,
        causeTree,
        primaryCauses,
        leafCauses: leafCauses.slice(0, 10),
        ishikawaAnalysis: Object.fromEntries(
          Object.entries(categoryAnalysis)
            .filter(([, v]) => v.causes.length > 0)
            .map(([k, v]) => [k, { count: v.causes.length, totalProbability: r(v.totalProbability), causes: v.causes.map(c => c.description) }])
        ),
        dominantCategory: dominantCategory ? { category: dominantCategory[0], probability: r(dominantCategory[1].totalProbability) } : null,
        rootCauseCount: leafCauses.length,
        highProbabilityCauses: primaryCauses.length,
      },
    };
  });

  /**
   * interventionDesign
   * Design interventions matched to identified causes.
   * artifact.data.causes = [{ id, description, category?, severity?, probability? }]
   * artifact.data.interventions = [{ id, description, targetCauseIds: string[], cost?, effort?, expectedEffectiveness?, timeToImplement? }]
   * Computes expected impact, cost-benefit scoring, and priority ranking.
   */
  registerLensAction("suffering", "interventionDesign", (ctx, artifact, _params) => {
    const causes = artifact.data?.causes || [];
    const interventions = artifact.data?.interventions || [];
    if (causes.length === 0) return { ok: false, error: "No causes provided." };
    if (interventions.length === 0) return { ok: false, error: "No interventions provided." };

    const r = (v) => Math.round(v * 1000) / 1000;

    // Index causes
    const causeMap = {};
    for (const c of causes) {
      causeMap[c.id] = {
        ...c,
        severity: c.severity ?? 5,
        probability: c.probability ?? 0.5,
      };
    }

    // Evaluate each intervention
    const evaluated = interventions.map((intv) => {
      const targetCauses = (intv.targetCauseIds || []).map(id => causeMap[id]).filter(Boolean);
      const cost = intv.cost ?? 50;
      const effort = intv.effort ?? 5; // 1-10 scale
      const effectiveness = intv.expectedEffectiveness ?? 0.5; // 0-1 probability of fixing the cause
      const timeToImplement = intv.timeToImplement ?? 30; // days

      // Expected impact: sum of (severity * probability * effectiveness) for targeted causes
      const expectedImpact = targetCauses.reduce((sum, cause) => {
        return sum + cause.severity * cause.probability * effectiveness;
      }, 0);

      // Risk reduction: weighted probability reduction across targeted causes
      const riskReduction = targetCauses.reduce((sum, cause) => {
        return sum + cause.probability * effectiveness;
      }, 0);

      // Cost-benefit ratio: impact per unit cost
      const costBenefitRatio = cost > 0 ? expectedImpact / cost : expectedImpact;

      // ROI estimate: (impact * 100 - cost) / cost
      const roi = cost > 0 ? ((expectedImpact * 100) - cost) / cost : expectedImpact * 100;

      // Priority score: combines impact, cost efficiency, and time urgency
      // Higher is better: impact / (cost * effort * sqrt(timeToImplement))
      const denominator = cost * effort * Math.sqrt(timeToImplement);
      const priorityScore = denominator > 0 ? (expectedImpact * 1000) / denominator : 0;

      // Coverage: what fraction of total cause severity is addressed
      const totalSeverity = Object.values(causeMap).reduce((s, c) => s + c.severity, 0);
      const addressedSeverity = targetCauses.reduce((s, c) => s + c.severity, 0);
      const coverage = totalSeverity > 0 ? addressedSeverity / totalSeverity : 0;

      return {
        id: intv.id,
        description: intv.description,
        targetCauses: targetCauses.map(c => ({ id: c.id, description: c.description })),
        targetCauseCount: targetCauses.length,
        cost,
        effort,
        effectiveness: r(effectiveness),
        timeToImplement,
        expectedImpact: r(expectedImpact),
        riskReduction: r(riskReduction),
        costBenefitRatio: r(costBenefitRatio),
        roi: r(roi),
        priorityScore: r(priorityScore),
        coverage: r(coverage),
      };
    });

    // Rank by priority score
    evaluated.sort((a, b) => b.priorityScore - a.priorityScore);

    // Check for uncovered causes
    const coveredCauseIds = new Set();
    for (const intv of interventions) {
      for (const id of (intv.targetCauseIds || [])) coveredCauseIds.add(id);
    }
    const uncoveredCauses = causes.filter(c => !coveredCauseIds.has(c.id)).map(c => ({
      id: c.id,
      description: c.description,
      severity: causeMap[c.id]?.severity,
    }));

    // Greedy set cover: find minimum set of interventions covering all causes
    const remaining = new Set(causes.map(c => c.id));
    const selectedSet = [];
    const availableIntvs = [...evaluated];
    while (remaining.size > 0 && availableIntvs.length > 0) {
      // Pick intervention with best coverage of remaining causes per unit cost
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < availableIntvs.length; i++) {
        const intv = interventions.find(x => x.id === availableIntvs[i].id);
        const covers = (intv?.targetCauseIds || []).filter(id => remaining.has(id)).length;
        const score = covers / (availableIntvs[i].cost || 1);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx === -1 || bestScore === 0) break;
      const chosen = availableIntvs.splice(bestIdx, 1)[0];
      selectedSet.push(chosen.id);
      const intv = interventions.find(x => x.id === chosen.id);
      for (const id of (intv?.targetCauseIds || [])) remaining.delete(id);
    }

    // Total cost and expected impact of top recommendations
    const topN = Math.min(3, evaluated.length);
    const topRecommendations = evaluated.slice(0, topN);
    const totalCostTop = topRecommendations.reduce((s, i) => s + i.cost, 0);
    const totalImpactTop = topRecommendations.reduce((s, i) => s + i.expectedImpact, 0);

    return {
      ok: true,
      result: {
        totalCauses: causes.length,
        totalInterventions: interventions.length,
        rankedInterventions: evaluated,
        topRecommendations: topRecommendations.map(i => ({ id: i.id, description: i.description, priorityScore: i.priorityScore, roi: i.roi })),
        topRecommendationsCost: totalCostTop,
        topRecommendationsImpact: r(totalImpactTop),
        uncoveredCauses,
        minimumCoverSet: selectedSet,
        coverageGap: uncoveredCauses.length,
        overallCoverage: r(1 - uncoveredCauses.length / causes.length),
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Parity-sprint macros — pain-point board, theming, intervention tracking,
  // trend view, evidence attachments, root-cause tree, report export.
  // Persistent per-user state lives in globalThis._concordSTATE.sufferingLens.
  // ─────────────────────────────────────────────────────────────────────────

  function getSufState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.sufferingLens) STATE.sufferingLens = {};
    const s = STATE.sufferingLens;
    for (const k of ["pains", "themes", "interventions", "snapshots"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveSufState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const sufUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sufId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clampNum = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const round = (v) => Math.round(v * 1000) / 1000;

  // ─── Pain-point board / prioritization matrix ───

  registerLensAction("suffering", "pain-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const pains = (s.pains.get(uid) || []).slice();
      // Derived priority score: impact-weighted severity discounted by effort.
      const ranked = pains.map((p) => {
        const priority = round((p.severity * p.frequency * p.impact) / Math.max(1, p.effort));
        return { ...p, priorityScore: priority };
      }).sort((a, b) => b.priorityScore - a.priorityScore);
      return {
        ok: true,
        result: {
          pains: ranked,
          count: ranked.length,
          openCount: ranked.filter((p) => p.status !== "resolved").length,
          resolvedCount: ranked.filter((p) => p.status === "resolved").length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "pain-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const pain = {
        id: sufId("pain"),
        title,
        description: String(params.description || "").trim(),
        severity: clampNum(params.severity, 1, 10, 5),
        frequency: clampNum(params.frequency, 1, 10, 5),
        impact: clampNum(params.impact, 1, 10, 5),
        effort: clampNum(params.effort, 1, 10, 5),
        status: "open",
        themeId: params.themeId ? String(params.themeId) : null,
        evidence: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const list = s.pains.get(uid) || [];
      list.push(pain);
      s.pains.set(uid, list);
      saveSufState();
      return { ok: true, result: { pain } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "pain-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.pains.get(uid) || [];
      const pain = list.find((p) => p.id === params.id);
      if (!pain) return { ok: false, error: "pain not found" };
      if (params.title != null) pain.title = String(params.title).trim() || pain.title;
      if (params.description != null) pain.description = String(params.description).trim();
      for (const k of ["severity", "frequency", "impact", "effort"]) {
        if (params[k] != null) pain[k] = clampNum(params[k], 1, 10, pain[k]);
      }
      if (params.status != null && ["open", "investigating", "in_progress", "resolved"].includes(params.status)) {
        pain.status = params.status;
      }
      if (params.themeId !== undefined) pain.themeId = params.themeId ? String(params.themeId) : null;
      pain.updatedAt = new Date().toISOString();
      saveSufState();
      return { ok: true, result: { pain } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "pain-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.pains.get(uid) || [];
      const idx = list.findIndex((p) => p.id === params.id);
      if (idx === -1) return { ok: false, error: "pain not found" };
      list.splice(idx, 1);
      s.pains.set(uid, list);
      saveSufState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Prioritization matrix — impact-vs-effort quadrants like Productboard.
  registerLensAction("suffering", "priority-matrix", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const pains = (s.pains.get(uid) || []).filter((p) => p.status !== "resolved");
      // Weighted impact = severity × frequency × impact, normalised to 1-10.
      const points = pains.map((p) => {
        const rawImpact = (p.severity * p.frequency * p.impact) / 100; // 1..10
        return {
          id: p.id,
          title: p.title,
          impact: round(rawImpact),
          effort: p.effort,
          status: p.status,
          themeId: p.themeId,
        };
      });
      const quadrant = (pt) => {
        const hiImpact = pt.impact >= 5;
        const loEffort = pt.effort <= 5;
        if (hiImpact && loEffort) return "quick_wins";
        if (hiImpact && !loEffort) return "major_projects";
        if (!hiImpact && loEffort) return "fill_ins";
        return "thankless";
      };
      const buckets = { quick_wins: [], major_projects: [], fill_ins: [], thankless: [] };
      for (const pt of points) buckets[quadrant(pt)].push(pt);
      return {
        ok: true,
        result: {
          points,
          quadrants: buckets,
          summary: {
            quickWins: buckets.quick_wins.length,
            majorProjects: buckets.major_projects.length,
            fillIns: buckets.fill_ins.length,
            thankless: buckets.thankless.length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Theming / clustering ───

  registerLensAction("suffering", "theme-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const themes = (s.themes.get(uid) || []).slice();
      const pains = s.pains.get(uid) || [];
      const enriched = themes.map((t) => {
        const members = pains.filter((p) => p.themeId === t.id);
        const totalPain = members.reduce(
          (sum, p) => sum + (p.severity * p.frequency * p.impact) / 100, 0);
        return {
          ...t,
          painCount: members.length,
          openCount: members.filter((p) => p.status !== "resolved").length,
          totalImpact: round(totalPain),
        };
      }).sort((a, b) => b.totalImpact - a.totalImpact);
      const unthemed = pains.filter((p) => !p.themeId).length;
      return { ok: true, result: { themes: enriched, count: enriched.length, unthemedPains: unthemed } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "theme-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const theme = {
        id: sufId("theme"),
        name,
        description: String(params.description || "").trim(),
        color: String(params.color || "#6366f1"),
        createdAt: new Date().toISOString(),
      };
      const list = s.themes.get(uid) || [];
      list.push(theme);
      s.themes.set(uid, list);
      saveSufState();
      return { ok: true, result: { theme } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "theme-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.themes.get(uid) || [];
      const idx = list.findIndex((t) => t.id === params.id);
      if (idx === -1) return { ok: false, error: "theme not found" };
      list.splice(idx, 1);
      s.themes.set(uid, list);
      // Orphan member pains.
      const pains = s.pains.get(uid) || [];
      for (const p of pains) if (p.themeId === params.id) p.themeId = null;
      saveSufState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Auto-cluster unthemed pains by keyword overlap in title/description.
  registerLensAction("suffering", "theme-autocluster", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const pains = (s.pains.get(uid) || []).filter((p) => !p.themeId);
      const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for",
        "is", "are", "with", "this", "that", "it", "be", "by", "as", "at", "i", "we"]);
      const tokens = (p) => `${p.title} ${p.description}`.toLowerCase()
        .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
      const tokenSets = pains.map((p) => ({ id: p.id, title: p.title, set: new Set(tokens(p)) }));
      // Union-find grouping on Jaccard ≥ 0.25.
      const parent = {};
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (const t of tokenSets) parent[t.id] = t.id;
      for (let i = 0; i < tokenSets.length; i++) {
        for (let j = i + 1; j < tokenSets.length; j++) {
          const a = tokenSets[i].set, b = tokenSets[j].set;
          if (a.size === 0 || b.size === 0) continue;
          let inter = 0;
          for (const w of a) if (b.has(w)) inter++;
          const jac = inter / (a.size + b.size - inter);
          if (jac >= 0.25) parent[find(tokenSets[i].id)] = find(tokenSets[j].id);
        }
      }
      const groups = {};
      for (const t of tokenSets) {
        const root = find(t.id);
        (groups[root] = groups[root] || []).push(t);
      }
      const suggestions = Object.values(groups)
        .filter((g) => g.length >= 2)
        .map((g) => {
          // Theme name = most frequent shared token.
          const freq = {};
          for (const m of g) for (const w of m.set) freq[w] = (freq[w] || 0) + 1;
          const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
          return {
            suggestedName: top ? top[0] : g[0].title,
            painIds: g.map((m) => m.id),
            painTitles: g.map((m) => m.title),
          };
        });
      return {
        ok: true,
        result: { suggestions, clusterCount: suggestions.length, unthemedAnalyzed: pains.length },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Evidence / quote attachments ───

  registerLensAction("suffering", "evidence-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.pains.get(uid) || [];
      const pain = list.find((p) => p.id === params.painId);
      if (!pain) return { ok: false, error: "pain not found" };
      const quote = String(params.quote || "").trim();
      if (!quote) return { ok: false, error: "quote required" };
      const ev = {
        id: sufId("ev"),
        quote,
        source: String(params.source || "").trim(),
        kind: ["quote", "metric", "log", "ticket"].includes(params.kind) ? params.kind : "quote",
        addedAt: new Date().toISOString(),
      };
      if (!Array.isArray(pain.evidence)) pain.evidence = [];
      pain.evidence.push(ev);
      pain.updatedAt = new Date().toISOString();
      saveSufState();
      return { ok: true, result: { painId: pain.id, evidence: pain.evidence } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "evidence-remove", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.pains.get(uid) || [];
      const pain = list.find((p) => p.id === params.painId);
      if (!pain) return { ok: false, error: "pain not found" };
      pain.evidence = (pain.evidence || []).filter((e) => e.id !== params.evidenceId);
      pain.updatedAt = new Date().toISOString();
      saveSufState();
      return { ok: true, result: { painId: pain.id, evidence: pain.evidence } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Intervention tracking ───

  registerLensAction("suffering", "intervention-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const interventions = (s.interventions.get(uid) || []).slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      const byStatus = { proposed: 0, in_progress: 0, completed: 0, abandoned: 0 };
      for (const i of interventions) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      return {
        ok: true,
        result: { interventions, count: interventions.length, byStatus },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "intervention-track", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const intv = {
        id: sufId("intv"),
        title,
        description: String(params.description || "").trim(),
        painId: params.painId ? String(params.painId) : null,
        status: "proposed",
        owner: String(params.owner || "").trim(),
        progress: 0,
        history: [{ at: new Date().toISOString(), status: "proposed", note: "Intervention created" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const list = s.interventions.get(uid) || [];
      list.push(intv);
      s.interventions.set(uid, list);
      saveSufState();
      return { ok: true, result: { intervention: intv } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "intervention-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.interventions.get(uid) || [];
      const intv = list.find((i) => i.id === params.id);
      if (!intv) return { ok: false, error: "intervention not found" };
      const statuses = ["proposed", "in_progress", "completed", "abandoned"];
      let statusChanged = false;
      if (params.status != null && statuses.includes(params.status) && params.status !== intv.status) {
        intv.status = params.status;
        statusChanged = true;
        if (params.status === "completed") intv.progress = 100;
      }
      if (params.progress != null) intv.progress = clampNum(params.progress, 0, 100, intv.progress);
      if (params.owner != null) intv.owner = String(params.owner).trim();
      if (params.description != null) intv.description = String(params.description).trim();
      if (statusChanged || params.note) {
        intv.history.push({
          at: new Date().toISOString(),
          status: intv.status,
          progress: intv.progress,
          note: String(params.note || `Status → ${intv.status}`).trim(),
        });
      }
      intv.updatedAt = new Date().toISOString();
      // Resolution cascade: completing an intervention can resolve its pain.
      if (intv.status === "completed" && intv.painId && params.resolvePain) {
        const pains = s.pains.get(uid) || [];
        const pain = pains.find((p) => p.id === intv.painId);
        if (pain) { pain.status = "resolved"; pain.updatedAt = new Date().toISOString(); }
      }
      saveSufState();
      return { ok: true, result: { intervention: intv } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "intervention-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.interventions.get(uid) || [];
      const idx = list.findIndex((i) => i.id === params.id);
      if (idx === -1) return { ok: false, error: "intervention not found" };
      list.splice(idx, 1);
      s.interventions.set(uid, list);
      saveSufState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Trend view — snapshot pain metrics over time ───

  registerLensAction("suffering", "snapshot-record", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const pains = s.pains.get(uid) || [];
      const open = pains.filter((p) => p.status !== "resolved");
      const totalPain = open.reduce(
        (sum, p) => sum + (p.severity * p.frequency * p.impact) / 100, 0);
      const avgSeverity = pains.length
        ? pains.reduce((sum, p) => sum + p.severity, 0) / pains.length : 0;
      const interventions = s.interventions.get(uid) || [];
      const snap = {
        id: sufId("snap"),
        at: new Date().toISOString(),
        totalPains: pains.length,
        openPains: open.length,
        resolvedPains: pains.length - open.length,
        totalImpact: round(totalPain),
        avgSeverity: round(avgSeverity),
        activeInterventions: interventions.filter((i) => i.status === "in_progress").length,
        completedInterventions: interventions.filter((i) => i.status === "completed").length,
      };
      const list = s.snapshots.get(uid) || [];
      list.push(snap);
      // Keep last 365 snapshots.
      if (list.length > 365) list.splice(0, list.length - 365);
      s.snapshots.set(uid, list);
      saveSufState();
      return { ok: true, result: { snapshot: snap } };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerLensAction("suffering", "trend-view", (ctx, _artifact, _params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const snapshots = (s.snapshots.get(uid) || []).slice()
        .sort((a, b) => new Date(a.at) - new Date(b.at));
      let direction = "flat";
      let delta = 0;
      if (snapshots.length >= 2) {
        const first = snapshots[0].totalImpact;
        const last = snapshots[snapshots.length - 1].totalImpact;
        delta = round(last - first);
        direction = delta > 0.5 ? "worsening" : delta < -0.5 ? "improving" : "flat";
      }
      return {
        ok: true,
        result: {
          snapshots,
          count: snapshots.length,
          direction,
          deltaImpact: delta,
          latest: snapshots[snapshots.length - 1] || null,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Root-cause tree (5-whys / fishbone) for a tracked pain ───

  registerLensAction("suffering", "root-cause-tree", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const list = s.pains.get(uid) || [];
      const pain = list.find((p) => p.id === params.painId);
      if (!pain) return { ok: false, error: "pain not found" };
      // params.causes = [{ id, description, parentId?, category?, probability? }]
      const causes = Array.isArray(params.causes) ? params.causes : (pain.causes || []);
      if (params.causes) { pain.causes = causes; pain.updatedAt = new Date().toISOString(); saveSufState(); }
      const ISHIKAWA = ["people", "process", "technology", "environment", "materials", "measurement"];
      const byId = {};
      const childIds = {};
      const rootIds = [];
      for (const c of causes) {
        byId[c.id] = { ...c, probability: clampNum(c.probability, 0, 1, 0.5) };
        childIds[c.id] = [];
      }
      for (const c of causes) {
        if (c.parentId && byId[c.parentId]) childIds[c.parentId].push(c.id);
        else rootIds.push(c.id);
      }
      const buildTree = (id) => {
        const n = byId[id];
        const kids = (childIds[id] || []).map(buildTree);
        return {
          id: n.id,
          label: n.description || n.id,
          detail: `${n.category || "uncategorized"} · p=${n.probability}`,
          tone: n.probability >= 0.66 ? "bad" : n.probability >= 0.33 ? "warn" : "default",
          children: kids,
        };
      };
      const tree = rootIds.map(buildTree);
      // Fishbone groups by Ishikawa category.
      const fishbone = {};
      for (const cat of ISHIKAWA) fishbone[cat] = [];
      for (const c of causes) {
        const cat = ISHIKAWA.includes((c.category || "").toLowerCase())
          ? c.category.toLowerCase() : "process";
        fishbone[cat].push({ id: c.id, description: c.description, probability: byId[c.id].probability });
      }
      const leaves = causes.filter((c) => (childIds[c.id] || []).length === 0)
        .map((c) => ({ id: c.id, description: c.description, probability: byId[c.id].probability }))
        .sort((a, b) => b.probability - a.probability);
      return {
        ok: true,
        result: {
          painId: pain.id,
          painTitle: pain.title,
          tree,
          fishbone: Object.fromEntries(Object.entries(fishbone).filter(([, v]) => v.length > 0)),
          rootCauses: leaves,
          causeCount: causes.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ─── Export full analysis as a report ───

  registerLensAction("suffering", "export-report", (ctx, _artifact, params = {}) => {
    try {
      const s = getSufState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = sufUid(ctx);
      const pains = (s.pains.get(uid) || []).slice();
      const themes = s.themes.get(uid) || [];
      const interventions = s.interventions.get(uid) || [];
      const snapshots = s.snapshots.get(uid) || [];
      const ranked = pains.map((p) => ({
        ...p,
        priorityScore: round((p.severity * p.frequency * p.impact) / Math.max(1, p.effort)),
      })).sort((a, b) => b.priorityScore - a.priorityScore);
      const format = params.format === "markdown" ? "markdown" : "json";
      const generatedAt = new Date().toISOString();
      if (format === "json") {
        return {
          ok: true,
          result: {
            format: "json",
            report: { generatedAt, pains: ranked, themes, interventions, snapshots },
          },
        };
      }
      // Markdown report.
      const lines = [];
      lines.push("# Pain-Point Analysis Report");
      lines.push(`Generated: ${generatedAt}`);
      lines.push("");
      lines.push(`## Summary`);
      lines.push(`- Pain points: ${pains.length} (${pains.filter((p) => p.status !== "resolved").length} open)`);
      lines.push(`- Themes: ${themes.length}`);
      lines.push(`- Interventions: ${interventions.length}`);
      lines.push("");
      lines.push("## Prioritized Pain Points");
      for (const p of ranked) {
        lines.push(`### ${p.title} — priority ${p.priorityScore}`);
        lines.push(`- Status: ${p.status}`);
        lines.push(`- Severity ${p.severity} · Frequency ${p.frequency} · Impact ${p.impact} · Effort ${p.effort}`);
        if (p.description) lines.push(`- ${p.description}`);
        if (Array.isArray(p.evidence) && p.evidence.length) {
          lines.push(`- Evidence:`);
          for (const ev of p.evidence) lines.push(`  - "${ev.quote}"${ev.source ? ` — ${ev.source}` : ""}`);
        }
        lines.push("");
      }
      if (interventions.length) {
        lines.push("## Interventions");
        for (const i of interventions) {
          lines.push(`- ${i.title} — ${i.status} (${i.progress}%)`);
        }
        lines.push("");
      }
      return {
        ok: true,
        result: { format: "markdown", markdown: lines.join("\n"), generatedAt },
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}
