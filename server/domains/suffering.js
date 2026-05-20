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
}
